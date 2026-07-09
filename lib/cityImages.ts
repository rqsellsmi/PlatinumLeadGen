/**
 * Per-city tile images for the homepage "Explore Your Market" section.
 *
 * Map a location SLUG to an image URL. These are intended to point at your
 * existing Vercel Blob assets (any absolute https URL works; a local
 * `/assets/…` path works too). When a slug has an entry here it is used for
 * that city's tile; otherwise the tile falls back to the most-recent office
 * sale photo, then to the static asset in ExploreMarket.
 *
 * Fill in the blob URLs you already have, e.g.:
 *   'brighton': 'https://xxxxxxxx.public.blob.vercel-storage.com/brighton.jpg',
 *
 * Leave the map empty to keep the current behaviour (most-recent sale photo).
 */
export const CITY_TILE_IMAGES: Record<string, string> = {
  // 'brighton': 'https://<blob-host>/brighton.jpg',
};

/** Configured tile image for a city slug, or null when none is set. */
export function cityTileImage(slug: string): string | null {
  const url = CITY_TILE_IMAGES[slug]?.trim();
  return url ? url : null;
}
