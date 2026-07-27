import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import IdxListingCard from '@/components/idx/IdxListingCard';
import IdxCompliance from '@/components/idx/IdxCompliance';
import SearchFilterPanel from '@/components/search/SearchFilterPanel';
import SearchMap, { type MapPin } from '@/components/search/SearchMap';
import { normalizeFilters, listingStatusLabel } from '@/lib/listingSearch';
import { searchListings } from '@/lib/idxSearch';
import { getPhotosForListings } from '@/lib/idx';

export const dynamic = 'force-dynamic';

// Parameterized search results — noindex (per spec §5); the canonical browse
// entry points are the homepage + city tiles.
export const metadata: Metadata = {
  title: 'Search Homes for Sale | RE/MAX Platinum',
  description:
    'Search homes for sale across Southeast Michigan. Filter by price, beds, baths, location and more.',
  robots: { index: false, follow: true },
};

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function HomesSearchPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = normalizeFilters(searchParams);
  const advancedOpen = searchParams.advanced === '1' || searchParams.advanced === 'true';

  const { rows, total, page, pageSize } = await searchListings(filters);
  const photos = rows.length ? await getPhotosForListings(rows.map((r) => r.listingKey)) : new Map();

  const pins: MapPin[] = rows
    .filter((r) => r.latitude != null && r.longitude != null)
    .map((r) => ({
      listingKey: r.listingKey,
      lat: r.latitude as number,
      lng: r.longitude as number,
      price: r.listPrice,
      address: r.address,
      city: r.city,
      status: listingStatusLabel(r),
      hidden: r.internetAddressDisplayYN === false,
      photoUrl: r.photoUrl,
    }));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
      else sp.set(k, v);
    }
    sp.set('page', String(p));
    return `/homes?${sp.toString()}`;
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5">
          <h1 className="text-3xl font-extrabold tracking-tight text-charcoal">
            {filters.city ? `Homes for sale in ${filters.city}` : 'Homes for sale'}
          </h1>
          <p className="mt-1 text-sm text-mute">
            {total.toLocaleString()} active {total === 1 ? 'listing' : 'listings'}
            {filters.city ? '' : ' across Southeast Michigan'}
          </p>
        </div>

        <SearchFilterPanel filters={filters} advancedOpen={advancedOpen} resultCount={total} />

        {pins.length > 0 ? <SearchMap pins={pins} /> : null}

        {rows.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-line bg-cream/50 px-6 py-16 text-center">
            <p className="text-lg font-semibold text-charcoal">No homes match your search</p>
            <p className="mt-2 text-sm text-mute">
              Try widening your price range, removing a filter, or searching a nearby city.
            </p>
            <Link
              href="/homes"
              className="mt-5 inline-block rounded-pill bg-platinum-blue px-5 py-2 text-sm font-semibold text-white hover:bg-platinum-blue/90"
            >
              Clear all filters
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((listing) => (
                <IdxListingCard
                  key={listing.listingKey}
                  listing={listing}
                  variant="sale"
                  photos={photos.get(listing.listingKey)}
                />
              ))}
            </div>

            {totalPages > 1 ? (
              <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-charcoal hover:border-platinum-blue">
                    ‹ Prev
                  </Link>
                ) : null}
                <span className="text-sm text-mute">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)} className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-charcoal hover:border-platinum-blue">
                    Next ›
                  </Link>
                ) : null}
              </nav>
            ) : null}

            <IdxCompliance variant="summary" firstOnPage />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
