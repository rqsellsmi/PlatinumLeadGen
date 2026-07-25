import Link from 'next/link';
import type { IdxCard } from '@/lib/idx';
import IdxListingCard from '@/components/idx/IdxListingCard';
import IdxCompliance from '@/components/idx/IdxCompliance';

/**
 * The 9 most-recent active listings on the buyer homepage. Renders nothing when
 * empty (no feed data yet), so the homepage never shows a broken section.
 */
export default function HomeActiveListings({
  listings,
  photos,
}: {
  listings: IdxCard[];
  photos: Map<string, string[]>;
}) {
  if (!listings.length) return null;

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
              Just listed
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
              Newest homes for sale
            </h2>
          </div>
          <Link
            href="/homes"
            className="rounded-pill border border-line px-5 py-2 text-sm font-semibold text-charcoal hover:border-platinum-blue"
          >
            See all homes →
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <IdxListingCard key={listing.listingKey} listing={listing} variant="sale" photos={photos.get(listing.listingKey)} />
          ))}
        </div>
        <IdxCompliance variant="summary" firstOnPage />
      </div>
    </section>
  );
}
