import type { IdxCard } from '@/lib/idx';
import IdxListingCard from './IdxListingCard';
import IdxCompliance from './IdxCompliance';

/**
 * A titled grid of IDX listing cards with the required disclosures beneath it
 * (IDX spec §4.3). Renders nothing when there are no listings (§4.4 — never
 * show an empty state, it looks broken).
 */
export default function IdxListingGrid({
  title,
  eyebrow,
  listings,
  variant,
  photosByListing,
  firstOnPage = false,
}: {
  title: string;
  eyebrow?: string;
  listings: IdxCard[];
  variant: 'sale' | 'sold';
  photosByListing?: Map<string, string[]>;
  firstOnPage?: boolean;
}) {
  if (!listings.length) return null;

  return (
    <section className="mt-10">
      {eyebrow ? (
        <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
          {eyebrow}
        </p>
      ) : null}
      <h3 className="text-2xl font-bold text-charcoal">{title}</h3>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => (
          <IdxListingCard
            key={listing.listingKey}
            listing={listing}
            variant={variant}
            photos={variant === 'sale' ? photosByListing?.get(listing.listingKey) : undefined}
          />
        ))}
      </div>
      <IdxCompliance variant="summary" firstOnPage={firstOnPage} />
    </section>
  );
}
