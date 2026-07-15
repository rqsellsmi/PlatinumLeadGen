import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ListingGallery from '@/components/idx/ListingGallery';
import ListingHero from '@/components/idx/ListingHero';
import ListingBackButton from '@/components/idx/ListingBackButton';
import AreaHighlights from '@/components/idx/AreaHighlights';
import MarketReport from '@/components/idx/MarketReport';
import RealcompLogo from '@/components/idx/RealcompLogo';
import IdxCompliance from '@/components/idx/IdxCompliance';
import { getListingByKey, getListingPhotos, getCityMarketReport, type IdxCard, type CityMarketReport } from '@/lib/idx';
import { showsFullGallery } from '@/lib/idxSync';
import { getAreaReport, type AreaReport } from '@/lib/nearbyPlaces';
import { getMarketNarrative } from '@/lib/marketNarrative';
import { formatCurrency, formatCompactCurrency, formatMonthYear } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * IDX listing detail pages are NOINDEX by default (they are mostly other
 * brokers' listings and would dilute the SEO city pages). Flip on by setting
 * IDX_INDEX_LISTINGS=1 — no code change needed.
 */
const INDEX_LISTING_PAGES = process.env.IDX_INDEX_LISTINGS === '1';

export async function generateMetadata({
  params,
}: {
  params: { listingKey: string };
}): Promise<Metadata> {
  const listing = await getListingByKey(decodeURIComponent(params.listingKey));
  const robots = INDEX_LISTING_PAGES ? undefined : { index: false, follow: false };
  if (!listing) return { title: 'Listing | RE/MAX Platinum', robots };
  const where = [listing.address, listing.city].filter(Boolean).join(', ');
  return {
    title: `${where || 'Property'} | RE/MAX Platinum`,
    description: 'Property details provided via IDX from Realcomp II Ltd.',
    robots,
  };
}

/** Human-readable status badge. Prefers the raw Realcomp label for the
 *  under-contract states ("Accepting Backup Offers" / "Contingent Continue to
 *  Show") since it's more specific than the normalized "Active Under Contract". */
function statusLabel(standardStatus: string, mlsStatus: string | null): string {
  if (standardStatus === 'Active') return 'For Sale';
  if (standardStatus === 'ActiveUnderContract') return mlsStatus?.trim() || 'Under Contract';
  if (standardStatus === 'Pending') return 'Pending';
  if (standardStatus === 'Closed') return 'Sold';
  return standardStatus;
}

type Fact = { label: string; value: string };
type Section = { title: string; facts: Fact[] };

const has = (hay: string | null | undefined, needle: string): boolean =>
  !!hay && hay.toLowerCase().includes(needle.toLowerCase());

/** Short marketing chips derived from the structured detail fields. */
function buildChips(l: IdxCard): string[] {
  const chips: string[] = [];
  if (l.waterfrontYN || l.waterBodyName) {
    if (l.waterBodyName) chips.push(`${l.waterBodyName} access`);
    else if (l.waterfrontFeatures) chips.push(l.waterfrontFeatures.split(',')[0].trim());
    else chips.push('Waterfront');
  }
  if (has(l.interiorFeatures, 'first floor primary') || has(l.interiorFeatures, 'entry level primary') || has(l.interiorFeatures, 'primary on main'))
    chips.push('1st-floor primary suite');
  if ((l.fireplacesTotal ?? 0) > 0 || l.fireplaceFeatures) {
    if (has(l.fireplaceFeatures, 'gas')) chips.push('Gas fireplace');
    else if ((l.fireplacesTotal ?? 0) > 1) chips.push(`${l.fireplacesTotal} fireplaces`);
    else chips.push('Fireplace');
  }
  if (has(l.laundryFeatures, 'main') || has(l.laundryFeatures, 'first floor')) chips.push('Main-floor laundry');
  if (has(l.basement, 'finished')) chips.push('Finished lower level');
  if (l.poolPrivateYN) chips.push('Private pool');
  if (l.newConstructionYN) chips.push('New construction');
  if ((l.garageSpaces ?? 0) > 0) chips.push(`${l.garageSpaces}-car garage`);
  // De-dupe and cap.
  return [...new Set(chips)].slice(0, 6);
}

/** Build the two detail columns, omitting empty values. */
function buildSections(l: IdxCard): Section[] {
  const interior: Fact[] = [];
  if (has(l.interiorFeatures, 'first floor primary') || has(l.interiorFeatures, 'entry level primary'))
    interior.push({ label: 'Primary suite', value: '1st floor' });
  if ((l.fireplacesTotal ?? 0) > 0 || l.fireplaceFeatures) {
    const kind = l.fireplaceFeatures ? l.fireplaceFeatures.split(',')[0].trim() : null;
    interior.push({
      label: 'Fireplace',
      value: [l.fireplacesTotal ?? null, kind].filter(Boolean).join(' · ') || 'Yes',
    });
  }
  const climate = [l.heating, l.cooling].filter(Boolean).join(' · ');
  if (climate) interior.push({ label: 'Heating / cooling', value: climate });
  if (l.basement) interior.push({ label: 'Basement', value: l.basement });
  if (l.laundryFeatures) interior.push({ label: 'Laundry', value: l.laundryFeatures });
  if ((l.garageSpaces ?? 0) > 0)
    interior.push({
      label: 'Garage',
      value: `${l.garageSpaces}${l.attachedGarageYN ? ' · attached' : ''}`,
    });
  if (l.appliances) interior.push({ label: 'Appliances', value: l.appliances });
  if (l.flooring) interior.push({ label: 'Flooring', value: l.flooring });
  if (l.levels || l.storiesTotal != null)
    interior.push({ label: 'Stories', value: l.levels || String(l.storiesTotal) });
  if (l.architecturalStyle) interior.push({ label: 'Style', value: l.architecturalStyle });
  if (l.roomsTotal != null) interior.push({ label: 'Total rooms', value: String(l.roomsTotal) });

  const lot: Fact[] = [];
  const propType = l.propertySubType ?? l.propertyType;
  if (propType) lot.push({ label: 'Property type', value: propType });
  if (l.waterfrontYN || l.waterBodyName)
    lot.push({
      label: 'Waterfront',
      value: [l.waterBodyName, l.waterfrontFeatures].filter(Boolean).join(' · ') || 'Yes',
    });
  if (l.lotSizeAcres != null)
    lot.push({
      label: 'Lot size',
      value: `${l.lotSizeAcres} acres${l.lotSizeDimensions ? ` · ${l.lotSizeDimensions}` : ''}`,
    });
  if (l.waterSource) lot.push({ label: 'Water', value: l.waterSource });
  if (l.sewer) lot.push({ label: 'Sewer', value: l.sewer });
  if (l.associationFee != null && l.associationFee > 0) {
    const freq = l.associationFeeFrequency ? `/${l.associationFeeFrequency.toLowerCase().replace(/ly$/, '').replace('month', 'mo').replace('annual', 'yr')}` : '';
    lot.push({ label: 'HOA dues', value: `${formatCurrency(Math.round(l.associationFee))}${freq}` });
  }
  if (l.taxAnnualAmount != null && l.taxAnnualAmount > 0)
    lot.push({
      label: 'Annual taxes',
      value: `${formatCurrency(Math.round(l.taxAnnualAmount))}${l.taxYear ? ` (${l.taxYear})` : ''}`,
    });
  if (l.schoolDistrict) lot.push({ label: 'School district', value: l.schoolDistrict });
  if (l.subdivisionName) lot.push({ label: 'Subdivision', value: l.subdivisionName });
  if (l.countyOrParish) lot.push({ label: 'County', value: l.countyOrParish });
  if (l.zoning) lot.push({ label: 'Zoning', value: l.zoning });

  return [
    { title: 'Interior & systems', facts: interior },
    { title: 'Lot, water & costs', facts: lot },
  ].filter((s) => s.facts.length > 0);
}

interface CompareTile {
  label: string;
  value: string;
  delta: string;
  good: boolean;
  areaLine: string;
}

/** How this sold home compared to its local market (mockup's dark block). */
function buildCompare(l: IdxCard, report: CityMarketReport): { tiles: CompareTile[]; outperformed: boolean } | null {
  const tiles: CompareTile[] = [];
  let wins = 0;
  let measured = 0;

  if (l.daysOnMarket != null && report.avgDaysOnMarket != null) {
    const diff = report.avgDaysOnMarket - l.daysOnMarket; // positive = sold faster
    const good = diff >= 0;
    measured += 1;
    if (good) wins += 1;
    tiles.push({
      label: 'Days on market',
      value: String(l.daysOnMarket),
      delta: diff === 0 ? 'at area pace' : `${Math.abs(diff)} ${good ? 'faster' : 'slower'}`,
      good,
      areaLine: `Area median ${report.avgDaysOnMarket}`,
    });
  }

  const s2l = l.closePrice && l.listPrice ? Math.round((l.closePrice / l.listPrice) * 1000) / 10 : null;
  if (s2l != null && report.listToSaleRatio != null) {
    const diff = Math.round((s2l - report.listToSaleRatio) * 10) / 10;
    const good = diff >= 0;
    measured += 1;
    if (good) wins += 1;
    tiles.push({
      label: 'Sale-to-list',
      value: `${s2l}%`,
      delta: `${diff >= 0 ? '+' : ''}${diff} pts`,
      good,
      areaLine: `Area median ${report.listToSaleRatio}%`,
    });
  }

  const ppsf = l.closePrice && l.livingArea ? Math.round(l.closePrice / l.livingArea) : null;
  if (ppsf != null && report.medianPricePerSqft != null) {
    const diff = ppsf - report.medianPricePerSqft;
    const good = diff >= 0;
    measured += 1;
    if (good) wins += 1;
    tiles.push({
      label: 'Sale $/sq ft',
      value: `$${ppsf}`,
      delta: good ? 'above area' : 'below area',
      good,
      areaLine: `Area median $${report.medianPricePerSqft}`,
    });
  }

  if (tiles.length === 0) return null;
  return { tiles, outperformed: measured > 0 && wins >= Math.ceil(measured / 2) };
}

export default async function ListingDetailPage({
  params,
}: {
  params: { listingKey: string };
}) {
  const listingKey = decodeURIComponent(params.listingKey);
  const listing = await getListingByKey(listingKey);
  if (!listing) notFound();

  // §18.10: full gallery for Active + Active Under Contract; primary photo only
  // for pending/sold.
  const showFullGallery = showsFullGallery(listing.standardStatus);
  const photos = showFullGallery
    ? await getListingPhotos(listing.listingKey, listing.standardStatus)
    : listing.photoUrl
      ? [listing.photoUrl]
      : [];

  const sold = listing.standardStatus === 'Closed';
  const price = sold ? listing.closePrice : listing.listPrice;
  const saleToList =
    sold && listing.closePrice && listing.listPrice
      ? Math.round((listing.closePrice / listing.listPrice) * 100)
      : null;
  const perSqft = price && listing.livingArea ? Math.round(price / listing.livingArea) : null;

  const beds = listing.bedsTotal;
  const baths = listing.bathsTotal;
  const sqft = listing.livingArea;

  const chips = buildChips(listing);
  const sections = buildSections(listing);

  // Optional enrichments — never let a failure break the page.
  const city = listing.city?.trim() || '';
  const [area, marketReport] = await Promise.all([
    getAreaReport(listing.latitude, listing.longitude).catch(() => null as AreaReport | null),
    city ? getCityMarketReport(city).catch(() => null) : Promise.resolve(null),
  ]);
  const narrative = marketReport ? await getMarketNarrative(city, marketReport).catch(() => null) : null;
  const compare = sold && marketReport ? buildCompare(listing, marketReport) : null;

  // Stat bar (dark) — sold shows the closing story; live shows the listing story.
  const statBar: { value: string; label: string; accent?: boolean }[] = sold
    ? [
        { value: listing.closeDate ? formatMonthYear(listing.closeDate) : '—', label: 'Closed' },
        { value: listing.daysOnMarket != null ? String(listing.daysOnMarket) : '—', label: 'Days on market' },
        { value: formatCompactCurrency(listing.listPrice), label: 'List price' },
        { value: saleToList != null ? `${saleToList}%` : '—', label: 'Sale-to-list', accent: true },
      ]
    : [
        { value: statusLabel(listing.standardStatus, listing.mlsStatus), label: 'Status' },
        { value: listing.daysOnMarket != null ? String(listing.daysOnMarket) : '—', label: 'Days on market' },
        { value: formatCompactCurrency(listing.listPrice), label: 'List price' },
        { value: perSqft != null ? `$${perSqft}` : '—', label: 'Per sq ft', accent: true },
      ];

  const eyebrow = [listing.subdivisionName, city].filter(Boolean).join(' · ').toUpperCase() || null;
  const cityLine = [listing.city, listing.stateOrProvince, listing.postalCode].filter(Boolean).join(', ');
  const galleryPhotos = showFullGallery && photos.length > 1 ? photos : [];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <ListingBackButton />

        {/* ---- Listing body. No RE/MAX branding or agent contact inside this
             block per §18.3.12. ---- */}
        <div className="mt-3">
          <ListingHero
            photoUrl={photos[0] ?? null}
            alt={listing.address ?? 'Property photo'}
            badge={sold && listing.closeDate ? `Sold ${formatMonthYear(listing.closeDate)}` : statusLabel(listing.standardStatus, listing.mlsStatus)}
            badgeTone={sold ? 'sold' : 'active'}
            eyebrow={eyebrow}
            address={listing.address}
            cityLine={cityLine}
            price={formatCurrency(price)}
            primaryOnlyNote={sold}
          />

          {/* Stat bar */}
          <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-card bg-charcoal text-white sm:grid-cols-4">
            {statBar.map((s, i) => (
              <div
                key={s.label}
                className={`px-4 py-4 text-center ${i > 0 ? 'border-l border-white/10' : ''} ${
                  i >= 2 ? 'border-t border-white/10 sm:border-t-0' : ''
                }`}
              >
                <dd className={`font-numeric text-xl font-black sm:text-2xl ${s.accent ? 'text-success' : ''}`}>
                  {s.value}
                </dd>
                <dt className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/60">
                  {s.label}
                </dt>
              </div>
            ))}
          </dl>

          {/* How this home compared — sold only, and shown ONLY when the home
              outperformed or matched its local market (hidden if it lagged). */}
          {compare && compare.outperformed ? (
            <section className="mt-3 overflow-hidden rounded-card bg-charcoal p-6 text-white sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">
                    How this home compared · {city} · {marketReport?.periodLabel}
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-white">Outperformed the local market</h2>
                </div>
                {marketReport ? (
                  <a
                    href="#market-report"
                    className="rounded-pill border border-white/25 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
                  >
                    Full market report →
                  </a>
                ) : null}
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {compare.tiles.map((t) => (
                  <div key={t.label} className="rounded-card bg-white/5 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/60">{t.label}</p>
                    <p className="mt-1 flex items-baseline gap-2">
                      <span className="font-numeric text-3xl font-black text-white">{t.value}</span>
                      <span className={`text-sm font-bold ${t.good ? 'text-success' : 'text-white/70'}`}>
                        {t.delta}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-white/55">{t.areaLine}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Beds / baths / sqft / year */}
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
            {[
              { value: beds != null ? String(beds) : '—', label: 'Beds' },
              { value: baths != null ? String(baths) : '—', label: 'Baths' },
              { value: sqft != null ? sqft.toLocaleString() : '—', label: 'Sq ft' },
              { value: listing.yearBuilt != null ? String(listing.yearBuilt) : '—', label: 'Built' },
            ].map((s) => (
              <div key={s.label} className="bg-white px-4 py-4 text-center">
                <dd className="font-numeric text-xl font-bold text-charcoal">{s.value}</dd>
                <dt className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mute-light">
                  {s.label}
                </dt>
              </div>
            ))}
          </dl>

          {/* Feature chips */}
          {chips.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {chips.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-line bg-cream px-3 py-1.5 text-sm font-semibold text-charcoal"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : null}

          {/* Description */}
          {listing.publicRemarks ? (
            <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-charcoal">
              {listing.publicRemarks}
            </p>
          ) : null}

          {/* Two-column detail */}
          {sections.length ? (
            <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {sections.map((section) => (
                <div key={section.title}>
                  <h2 className="border-b-2 border-platinum-red pb-1.5 text-xs font-bold uppercase tracking-[0.1em] text-platinum-red">
                    {section.title}
                  </h2>
                  <dl className="mt-1">
                    {section.facts.map((f, i) => (
                      <div
                        key={f.label}
                        className={`flex items-start justify-between gap-4 py-2.5 text-sm ${
                          i > 0 ? 'border-t border-line' : ''
                        }`}
                      >
                        <dt className="text-mute">{f.label}</dt>
                        <dd className="text-right font-semibold text-charcoal">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          ) : null}

          {/* MLS number line */}
          <p className="mt-6 text-xs text-mute-light">
            {[
              listing.mlsNumber ? `MLS #${listing.mlsNumber}` : null,
              listing.countyOrParish ? `${listing.countyOrParish} County` : null,
              listing.subdivisionName ? `Subdivision: ${listing.subdivisionName}` : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </p>

          {listing.virtualTourUrl ? (
            <p className="mt-3">
              <a
                href={listing.virtualTourUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-platinum-blue hover:underline"
              >
                View virtual tour →
              </a>
            </p>
          ) : null}

          {/* Browsable gallery (Active / Under Contract only). */}
          {galleryPhotos.length ? (
            <div className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-charcoal">Photos</h2>
              <ListingGallery photos={galleryPhotos} alt={listing.address ?? 'Property photo'} />
            </div>
          ) : null}
        </div>

        {/* ---- Realcomp office credit + logo + copyright, immediately after the
             property body (§18.3.4). ---- */}
        <div className="mt-8 flex items-center gap-3 border-t border-line pt-4">
          <RealcompLogo size={28} />
          <div className="text-sm text-mute">
            {listing.listingOfficeName ? (
              <p className="font-semibold text-charcoal">
                Listed by {listing.listingOfficeName}
                {listing.listingOfficePhone ? ` · ${listing.listingOfficePhone}` : ''}
              </p>
            ) : null}
          </div>
        </div>

        {/* ---- Neighborhood highlights (map + nearby POIs). ---- */}
        {area && listing.latitude != null && listing.longitude != null ? (
          <AreaHighlights
            report={area}
            latitude={listing.latitude}
            longitude={listing.longitude}
            locationLabel={city || null}
          />
        ) : null}

        {/* ---- Full market report card ---- */}
        {marketReport ? (
          <div id="market-report" className="mt-8 scroll-mt-24">
            <MarketReport report={marketReport} cityName={city} narrative={narrative} />
          </div>
        ) : null}

        {/* ---- Seller CTA footer ---- */}
        <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-cream px-6 py-5">
          <p className="text-sm font-semibold text-charcoal">
            Own a home in {listing.subdivisionName || city || 'the area'}? See what yours could sell for in
            today&apos;s market.
          </p>
          <Link
            href="/"
            className="whitespace-nowrap rounded-pill bg-platinum-red px-6 py-3 text-sm font-bold text-white hover:bg-platinum-redHover"
          >
            Get my home value →
          </Link>
        </section>

        <IdxCompliance
          variant="detail"
          firstOnPage
          originatingSystemName={listing.originatingSystemName}
        />
      </main>
      <SiteFooter latitude={listing.latitude} longitude={listing.longitude} />
    </>
  );
}
