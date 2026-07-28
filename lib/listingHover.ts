/**
 * Tiny client-side event bus linking the /homes results list and the map so
 * hovering a listing card highlights its map pin, and hovering a pin highlights
 * its card. A window CustomEvent (same pattern as OPEN_VALUATION_EVENT) keeps the
 * server-rendered cards and the client map decoupled — no shared React tree.
 *
 * `from` prevents feedback loops: each side emits with its own source and ignores
 * events it sent (the map listens for 'card', the cards listen for 'map').
 */
export interface ListingHoverDetail {
  /** The hovered listing, or null when the hover ends. */
  key: string | null;
  from: 'card' | 'map';
}

export const LISTING_HOVER_EVENT = 'pl:listing-hover';

export function emitListingHover(key: string | null, from: 'card' | 'map'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ListingHoverDetail>(LISTING_HOVER_EVENT, { detail: { key, from } }));
}

/** Subscribe to hover events; returns an unsubscribe fn. */
export function onListingHover(cb: (d: ListingHoverDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<ListingHoverDetail>).detail);
  window.addEventListener(LISTING_HOVER_EVENT, handler);
  return () => window.removeEventListener(LISTING_HOVER_EVENT, handler);
}
