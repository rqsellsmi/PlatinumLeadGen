/**
 * Hero background images for the homepage and city pages. The hero picks one of
 * these per page load (see components/HeroBackdrop.tsx).
 *
 * SOURCE: the Vercel Blob storage folder "Hero Images/" (override the prefix
 * with HERO_IMAGES_BLOB_PREFIX). `getHeroImages()` lists that folder at request
 * time (cached in-process for a few minutes) and returns the public blob URLs,
 * so dropping a new photo into the blob folder adds it to the rotation with no
 * code change or redeploy. If the blob token is missing, the folder is empty, or
 * the list call fails, it falls back to the bundled `/public/assets` images
 * below — the hero always renders something.
 */
import { list } from '@vercel/blob';

/** Fallback images (bundled in /public/assets) when the blob folder is unavailable. */
export const HERO_IMAGES: string[] = [
  '/assets/hero-home.jpg',
  '/assets/hero-home-2.jpg',
];

/** Blob "folder" the hero images live in. A trailing slash scopes the prefix. */
const HERO_BLOB_PREFIX = (process.env.HERO_IMAGES_BLOB_PREFIX || 'Hero Images/').trim();
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
const TTL_MS = 5 * 60 * 1000;

let cached: { at: number; urls: string[] } | null = null;

/**
 * The hero image URLs, from the "Hero Images/" Vercel Blob folder. Cached
 * in-process for a few minutes so we don't re-list the folder on every render.
 * Always returns a non-empty list (falls back to the bundled assets).
 */
export async function getHeroImages(): Promise<string[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.urls;

  // list() needs a read/write token; without it, use the bundled assets.
  if (!process.env.BLOB_READ_WRITE_TOKEN) return HERO_IMAGES;

  try {
    const urls: string[] = [];
    let cursor: string | undefined;
    // Page through the folder (list() caps at 1000 per call).
    do {
      const res = await list({ prefix: HERO_BLOB_PREFIX, cursor, limit: 1000 });
      for (const b of res.blobs) {
        if (IMAGE_RE.test(b.pathname)) urls.push(b.url);
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);

    // Stable order by pathname so the "first = priority LCP" pick is deterministic.
    urls.sort((a, b) => a.localeCompare(b));

    const result = urls.length ? urls : HERO_IMAGES;
    cached = { at: Date.now(), urls: result };
    return result;
  } catch (err) {
    console.error('[heroImages] blob list failed; using bundled assets:', err);
    return HERO_IMAGES;
  }
}
