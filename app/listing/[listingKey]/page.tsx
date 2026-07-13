import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ListingGallery from '@/components/idx/ListingGallery';
import RealcompLogo from '@/components/idx/RealcompLogo';
import IdxCompliance from '@/components/idx/IdxCompliance';
import { getListingByKey, getListingPhotos } from '@/lib/idx';
import { showsFullGallery } from '@/lib/idxSync';
import { formatCurrency, formatMonthYear } from '@/lib/utils';

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

function isActive(status: string): boolean {
  return status === 'Active';
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

export default async function ListingDetailPage({
  params,
}: {
  params: { listingKey: string };
}) {
  const listingKey = decodeURIComponent(params.listingKey);
  const listing = await getListingByKey(listingKey);
  if (!listing) notFound();

  // §18.10: full gallery for Active + Active Under Contract; primary photo only
  // for pending/sold. Galleries are only stored for gallery-eligible statuses,
  // so pending/sold fall back to the primary photo column.
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

  const beds = listing.bedsTotal;
  const baths = listing.bathsTotal;
  const sqft = listing.livingArea;

  const facts: { label: string; value: string }[] = [];
  if (listing.propertySubType || listing.propertyType)
    facts.push({ label: 'Property type', value: (listing.propertySubType ?? listing.propertyType) as string });
  if (listing.yearBuilt != null) facts.push({ label: 'Year built', value: String(listing.yearBuilt) });
  if (listing.lotSizeAcres != null) facts.push({ label: 'Lot size', value: `${listing.lotSizeAcres} acres` });
  if (listing.garageSpaces != null) facts.push({ label: 'Garage', value: `${listing.garageSpaces} spaces` });
  if (listing.basement) facts.push({ label: 'Basement', value: listing.basement });
  if (listing.schoolDistrict) facts.push({ label: 'School district', value: listing.schoolDistrict });
  if (listing.subdivisionName) facts.push({ label: 'Subdivision', value: listing.subdivisionName });
  if (listing.countyOrParish) facts.push({ label: 'County', value: listing.countyOrParish });
  if (!sold && listing.daysOnMarket != null)
    facts.push({ label: 'Days on market', value: String(listing.daysOnMarket) });
  if (listing.waterfrontYN) {
    facts.push({
      label: 'Waterfront',
      value: [listing.waterBodyName, listing.waterfrontFeatures].filter(Boolean).join(' · ') || 'Yes',
    });
  }
  if (listing.mlsNumber) facts.push({ label: 'MLS #', value: listing.mlsNumber });

  const specLine = [
    beds != null ? `${beds} bd` : null,
    baths != null ? `${baths} ba` : null,
    sqft != null ? `${sqft.toLocaleString()} sqft` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <Link href="/" className="text-sm font-semibold text-platinum-blue hover:underline">
          ← Back
        </Link>

        {/* ---- Listing body (property info + photos). No RE/MAX branding or
             agent contact inside this block per §18.3.12. ---- */}
        <div className="mt-4">
          <ListingGallery photos={photos} alt={listing.address ?? 'Property photo'} />

          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="font-numeric text-4xl font-bold text-charcoal">{formatCurrency(price)}</p>
              {saleToList != null ? (
                <p className="mt-0.5 text-sm text-mute">
                  Sold {saleToList >= 100 ? `${saleToList - 100}% over` : `${100 - saleToList}% under`} asking
                </p>
              ) : null}
            </div>
            <span
              className={`rounded px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-white ${
                isActive(listing.standardStatus) ? 'bg-success' : 'bg-platinum-red'
              }`}
            >
              {sold && listing.closeDate
                ? `Sold ${formatMonthYear(listing.closeDate)}`
                : statusLabel(listing.standardStatus, listing.mlsStatus)}
            </span>
          </div>

          {specLine ? <p className="mt-2 text-lg text-charcoal">{specLine}</p> : null}
          {listing.address ? (
            <h1 className="mt-1 text-2xl font-bold text-charcoal">{listing.address}</h1>
          ) : null}
          <p className="text-mute">
            {[listing.city, listing.stateOrProvince, listing.postalCode].filter(Boolean).join(', ')}
          </p>

          {facts.length ? (
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {facts.map((f) => (
                <div key={f.label} className="rounded-card border border-line bg-white p-4">
                  <dd className="font-semibold text-charcoal">{f.value}</dd>
                  <dt className="mt-0.5 text-xs text-mute-light">{f.label}</dt>
                </div>
              ))}
            </dl>
          ) : null}

          {listing.publicRemarks ? (
            <div className="mt-6">
              <h2 className="text-lg font-bold text-charcoal">About this home</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-charcoal">
                {listing.publicRemarks}
              </p>
            </div>
          ) : null}

          {listing.virtualTourUrl ? (
            <p className="mt-4">
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

          {!showFullGallery ? (
            <p className="mt-4 text-xs italic text-mute-light">
              Per MLS rules, only the primary photo is shown for pending and sold listings.
            </p>
          ) : null}
        </div>

        {/* ---- Immediately following the property information (§18.3.4):
             listing office name, the Realcomp approved logo, and the Realcomp
             copyright/MLS credit. ---- */}
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

        <IdxCompliance
          variant="detail"
          firstOnPage
          originatingSystemName={listing.originatingSystemName}
        />
      </main>
      <SiteFooter />
    </>
  );
}
