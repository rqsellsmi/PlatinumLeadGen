import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import SavedHomesGrid from '@/components/buyer/SavedHomesGrid';
import SavedSearchList from '@/components/buyer/SavedSearchList';
import BuyerValuationCard from '@/components/buyer/BuyerValuationCard';
import { getCurrentBuyer } from '@/lib/buyerSession';
import { listFavoriteKeys, listSavedSearches } from '@/lib/buyerSaves';
import { getListingsByKeys, getPhotosForListings, type IdxCard } from '@/lib/idx';
import { showsFullGallery } from '@/lib/idxSync';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Account | RE/MAX Platinum',
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const buyer = await getCurrentBuyer();
  // Middleware already guards this route; this is a defense-in-depth fallback.
  if (!buyer) redirect('/?signin=1&next=/account');

  const [favKeys, searches] = await Promise.all([
    listFavoriteKeys(buyer.id),
    listSavedSearches(buyer.id),
  ]);

  // Hydrate favorite cards + photos, preserving the newest-first order of favKeys.
  let favItems: { listing: IdxCard; photos?: string[] }[] = [];
  if (favKeys.length) {
    const [listings, photoMap] = await Promise.all([
      getListingsByKeys(favKeys),
      getPhotosForListings(favKeys),
    ]);
    const byKey = new Map(listings.map((l) => [l.listingKey, l]));
    favItems = favKeys
      .map((k) => byKey.get(k))
      .filter((l): l is IdxCard => Boolean(l))
      .map((l) => {
        const all = photoMap.get(l.listingKey) ?? [];
        return { listing: l, photos: showsFullGallery(l.standardStatus) ? all : all.slice(0, 1) };
      });
  }

  const firstName = buyer.name?.trim().split(/\s+/)[0] || null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-charcoal">
            {firstName ? `Welcome back, ${firstName}` : 'My account'}
          </h1>
          <p className="mt-1 text-sm text-mute">Your saved homes and searches, all in one place.</p>
        </header>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-charcoal">Saved homes</h2>
          <SavedHomesGrid items={favItems} />
          {favKeys.length > favItems.length ? (
            <p className="mt-3 text-xs text-mute">
              Some saved homes are no longer available and aren&rsquo;t shown.
            </p>
          ) : null}
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-charcoal">Saved searches</h2>
          <SavedSearchList initial={searches.map((s) => ({ id: s.id, name: s.name, filters: s.filters }))} />
        </section>

        <section>
          <BuyerValuationCard />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
