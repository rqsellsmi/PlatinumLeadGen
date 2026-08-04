import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ThankYouClient from './ThankYouClient';
import {
  getLocationBySlug,
  getMarketStats,
  getCityRecentSales,
  getFeaturedRecentSales,
  locationMatchCities,
  type HomeRecentSale,
} from '@/lib/queries';
import { getRevealedValuation, type RevealedValuation } from '@/lib/valuationStore';
import { refreshIfStale } from '@/lib/valuationCache';
import { getReportContext, logReportView } from '@/lib/reportAccess';
import {
  getSimilarHomes,
  getRecentSoldComps,
  getCityMarketReport,
  getPhotosForListings,
  type IdxCard,
  type CityMarketReport,
} from '@/lib/idx';
import { getMarketNarrative } from '@/lib/marketNarrative';
import { activeProvider } from '@/lib/valuation';
import type { MarketStat } from '@/drizzle/schema';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Home Valuation Report | RE/MAX Platinum',
  description: 'Your personalized home valuation report from RE/MAX Platinum.',
  robots: { index: false, follow: false },
};

/** Load the IDX Similar Homes / sold comps / market stats for the subject home. */
async function loadIdxSections(
  report: RevealedValuation | null,
  idxCity: string,
): Promise<{
  forSale: IdxCard[];
  sold: IdxCard[];
  forSalePhotos: Record<string, string[]>;
  marketReport: CityMarketReport | null;
  marketNarrative: string | null;
}> {
  const empty = { forSale: [], sold: [], forSalePhotos: {}, marketReport: null, marketNarrative: null };
  if (!report) return empty;
  try {
    const est = report.estimatedValue;
    const lat = report.latitude;
    const lng = report.longitude;
    const b = report.basics;

    const [forSale, sold, marketReport] = await Promise.all([
      est != null
        ? getSimilarHomes({
            latitude: lat,
            longitude: lng,
            priceRangeLow: est * 0.8,
            priceRangeHigh: est * 1.2,
            // Subject attributes → rank comps by matching as many fields as
            // possible (location, beds, baths, sqft, type, year, price).
            estimatedValue: est,
            city: idxCity || null,
            beds: b?.beds ?? null,
            baths: b?.baths ?? null,
            sqft: b?.sqft ?? null,
            yearBuilt: b?.yearBuilt ?? null,
            propertyType: b?.propertyType ?? null,
            limit: 6,
          })
        : Promise.resolve([]),
      getRecentSoldComps({
        latitude: lat,
        longitude: lng,
        city: idxCity || null,
        // Subject attributes → rank sold comps by matching size/beds/baths/type/
        // year/price + proximity, not just same mailing city (matches the
        // for-sale similar-homes ranker).
        estimatedValue: est,
        beds: b?.beds ?? null,
        baths: b?.baths ?? null,
        sqft: b?.sqft ?? null,
        yearBuilt: b?.yearBuilt ?? null,
        propertyType: b?.propertyType ?? null,
        withinDays: 90,
        limit: 6,
      }),
      idxCity ? getCityMarketReport(idxCity) : Promise.resolve(null),
    ]);

    const photoMap = await getPhotosForListings(forSale.map((l) => l.listingKey));
    const forSalePhotos: Record<string, string[]> = {};
    for (const [k, v] of photoMap) forSalePhotos[k] = v;

    const marketNarrative =
      marketReport && idxCity ? await getMarketNarrative(idxCity, marketReport).catch(() => null) : null;

    return { forSale, sold, forSalePhotos, marketReport, marketNarrative };
  } catch (err) {
    // idx_listings may not be populated yet (or migrated) — degrade to nothing.
    console.error('[thank-you] IDX sections failed:', err);
    return empty;
  }
}

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: { city?: string; v?: string; report?: string };
}) {
  const citySlug = (searchParams.city ?? '').trim();
  const token = (searchParams.v ?? '').trim();
  const reportTok = (searchParams.report ?? '').trim();

  let cityName = '';
  let snapshot: MarketStat | null = null;
  let comps: HomeRecentSale[] = [];

  // Resolve the revealed valuation + subject city. The durable report token
  // (from the confirmation email / post-submit redirect) is preferred; the
  // valuation token (`v`) is the legacy immediate-reveal path.
  let report: RevealedValuation | null = null;
  let subjectCity = '';
  // Optional appointment-form prefill for visits that arrive via the durable
  // report link (a fresh session with no sessionStorage handoff). The lead's own
  // details sit behind their report token; the client prefers sessionStorage and
  // falls back to this. Null when there's no lead context (legacy `v` path).
  let leadPrefill: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    leadId: number | null;
  } | null = null;
  if (reportTok) {
    const ctx = await getReportContext(reportTok);
    if (ctx) {
      subjectCity = ctx.city ?? '';
      leadPrefill = {
        firstName: ctx.firstName,
        lastName: ctx.lastName,
        phone: ctx.phone,
        email: ctx.email,
        leadId: ctx.leadId,
      };
      report = ctx.revealed
        ? {
            // The lead's own copy of the numbers wins (an agent may have
            // corrected them); everything else comes off the valuation row.
            ...ctx.revealed,
            address: ctx.address ?? ctx.revealed.address,
            estimatedValue: ctx.estimatedValue,
            priceRangeLow: ctx.priceRangeLow,
            priceRangeHigh: ctx.priceRangeHigh,
            latitude: ctx.latitude,
            longitude: ctx.longitude,
          }
        : {
            id: 0, // no valuation row — nothing to refresh
            provider: 'idx',
            address: ctx.address,
            estimatedValue: ctx.estimatedValue,
            priceRangeLow: ctx.priceRangeLow,
            priceRangeHigh: ctx.priceRangeHigh,
            confidenceScore: null,
            isUncertain: false,
            basics: null,
            detail: null,
            saleHistory: [],
            attomId: null,
            areaGeoId: null,
            latitude: ctx.latitude,
            longitude: ctx.longitude,
            valuedAt: null,
          };
      await logReportView(ctx.leadId); // admin access log (§8.3)
    }
  } else if (token) {
    report = await getRevealedValuation(token);
  }

  // Provider data older than 30 days is re-priced on view and written back, so
  // a report opened months later shows a current number rather than a stale one.
  // No-ops when the data is fresh; never a second call within the window.
  if (report?.id) report = await refreshIfStale(report);

  if (citySlug) {
    const loc = await getLocationBySlug(citySlug);
    if (loc) {
      cityName = loc.name.split(',')[0].trim();
      [snapshot, comps] = await Promise.all([
        getMarketStats(loc.id),
        getCityRecentSales(locationMatchCities(loc), 6),
      ]);
    }
  }
  if (comps.length === 0) comps = await getFeaturedRecentSales(6);

  // IDX Similar Homes / sold comps / market report for the Full Valuation page.
  const idxCity = subjectCity || cityName;
  const idx = await loadIdxSections(report, idxCity);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <Suspense fallback={null}>
          <ThankYouClient
            report={report}
            valuationProvider={activeProvider()}
            comps={comps}
            snapshot={snapshot}
            cityName={cityName}
            idxForSale={idx.forSale}
            idxSold={idx.sold}
            idxForSalePhotos={idx.forSalePhotos}
            idxMarketReport={idx.marketReport}
            idxMarketNarrative={idx.marketNarrative}
            idxCityName={idxCity}
            leadPrefill={leadPrefill}
          />
        </Suspense>
        <div className="mt-10 text-center">
          <Link href="/" className="text-sm font-semibold text-platinum-blue hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter latitude={report?.latitude} longitude={report?.longitude} />
    </>
  );
}
