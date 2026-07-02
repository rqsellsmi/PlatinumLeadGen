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
import type { MarketTrends } from '@/lib/valuation';
import type { MarketStat } from '@/drizzle/schema';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Home Valuation Report | RE/MAX Platinum',
  description: 'Your personalized home valuation report from RE/MAX Platinum.',
  robots: { index: false, follow: false },
};

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: { city?: string; v?: string };
}) {
  const citySlug = (searchParams.city ?? '').trim();
  const token = (searchParams.v ?? '').trim();

  let cityName = '';
  let snapshot: MarketStat | null = null;
  let comps: HomeRecentSale[] = [];
  let compsSource: 'platinum' | 'area' = 'platinum';
  let marketTrends: MarketTrends | null = null;

  // Reveal the full valuation ONLY if the token maps to a converted lead.
  const report: RevealedValuation | null = token ? await getRevealedValuation(token) : null;

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

  // ATTOM enrichments — only for a revealed (converted) ATTOM valuation, so
  // billable calls are bounded to real leads. Both degrade to nothing on error.
  if (report?.provider === 'attom') {
    const { getAttomAreaTrends, getAttomComps } = await import('@/lib/attom');
    if (report.areaGeoId) {
      marketTrends = await getAttomAreaTrends(report.areaGeoId).catch(() => null);
    }
    // Fallback comps only when we have no RE/MAX Platinum closings to show.
    if (comps.length === 0 && report.attomId) {
      const attomComps = await getAttomComps(report.attomId, 6).catch(() => []);
      if (attomComps.length) {
        comps = attomComps;
        compsSource = 'area';
      }
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <Suspense fallback={null}>
          <ThankYouClient
            report={report}
            comps={comps}
            compsSource={compsSource}
            marketTrends={marketTrends}
            snapshot={snapshot}
            cityName={cityName}
          />
        </Suspense>
        <div className="mt-10 text-center">
          <Link href="/" className="text-sm font-semibold text-platinum-blue hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
