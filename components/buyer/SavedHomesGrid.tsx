'use client';

import * as React from 'react';
import type { IdxCard } from '@/lib/idx';
import IdxListingCard from '@/components/idx/IdxListingCard';
import { useFavorites } from './useFavorites';

/**
 * The account "Saved homes" grid. Server-renders the current favorites, then
 * hides a card the moment its heart is un-toggled (reading the shared favorites
 * store) so removal feels instant without a reload.
 */
export default function SavedHomesGrid({
  items,
}: {
  items: { listing: IdxCard; photos?: string[] }[];
}) {
  const { loaded, isFavorite } = useFavorites();

  // Before the store has loaded, show everything the server gave us; once loaded,
  // reflect live toggles.
  const visible = loaded ? items.filter((it) => isFavorite(it.listing.listingKey)) : items;

  if (visible.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-cream/50 px-6 py-12 text-center text-sm text-mute">
        You haven&rsquo;t saved any homes yet. Tap the heart on any listing to save it here.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((it) => (
        <IdxListingCard key={it.listing.listingKey} listing={it.listing} variant="sale" photos={it.photos} />
      ))}
    </div>
  );
}
