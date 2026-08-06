/**
 * Hero background images for the homepage and city pages. The hero picks one of
 * these per page load (see components/HeroBackdrop.tsx).
 *
 * SOURCE: the Vercel Blob storage folder "Hero Images/" (override the prefix
 * with HERO_IMAGES_BLOB_PREFIX). `getHeroImages()` lists that folder and returns
 * the public blob URLs, so dropping a new photo into the blob folder adds it to
 * the rotation with no code change or redeploy. If the blob token is missing,
 * the folder is empty, or the list call fails, it falls back to the bundled
 * `/public/assets` images below — the hero always renders something.
 *
 * CACHING — this is a cost control, not a perf tweak. Blob `list()` bills as an
 * "Advanced Operation" (2,000/month on the free plan). This used to cache in a
 * module-level variable with a 5-minute TTL, which is PER SERVERLESS INSTANCE:
 * every cold start re-listed, and a warm instance re-listed 12x/hour. That ran
 * at ~65 list calls/day — almost exactly the 2,000/month allowance, so the store
 * sat permanently near its quota. `unstable_cache` stores the result in the Next
 * Data Cache, which is SHARED ACROSS INSTANCES, so a 24h revalidate means ~1
 * list/day total. The trade is that a newly-uploaded photo joins the rotation
 * within a day rather than within minutes, which is the intended behavior.
 */
import { unstable_cache } from 'next/cache';
import { list } from '@vercel/blob';

/** Fallback image(s) (bundled in /public/assets) when the blob folder is
 *  unavailable. Only list files that actually exist — a missing entry would 404
 *  and defeat the fallback (hero-home-2.jpg was removed). */
export const HERO_IMAGES: string[] = [
  '/assets/hero-home.jpg',
];

/** Blob "folder" the hero images live in. A trailing slash scopes the prefix. */
const HERO_BLOB_PREFIX = (process.env.HERO_IMAGES_BLOB_PREFIX || 'Hero Images/').trim();
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;

/** How long a listing stays cached. A new photo appears within this window. */
const REVALIDATE_SECONDS = 24 * 60 * 60;

// Read-write token for the store holding the hero images. Vercel names this
// <PREFIX>_READ_WRITE_TOKEN; the hero images live in a dedicated PUBLIC store
// connected with the BLOB_PUB prefix (public access is required — the browser
// fetches these URLs unauthenticated), so prefer BLOB_PUB_READ_WRITE_TOKEN and
// fall back to the default name. Passed explicitly to list() because the SDK
// only auto-reads BLOB_READ_WRITE_TOKEN.
const HERO_BLOB_TOKEN =
  process.env.BLOB_PUB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

/**
 * List the blob folder. Deliberately does NOT catch — a thrown error propagates
 * out of `unstable_cache` and nothing is written to the Data Cache, so a
 * transient Blob outage can't pin the bundled fallback in place for 24 hours.
 * The caller handles the failure instead. Returns the raw URLs (possibly empty)
 * so the cached value is the folder's actual contents, not a fallback.
 */
async function listHeroImages(): Promise<string[]> {
  const urls: string[] = [];
  let cursor: string | undefined;
  // Page through the folder (list() caps at 1000 per call).
  do {
    const res = await list({ prefix: HERO_BLOB_PREFIX, cursor, limit: 1000, token: HERO_BLOB_TOKEN });
    for (const b of res.blobs) {
      if (IMAGE_RE.test(b.pathname)) urls.push(b.url);
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);

  // Stable order by pathname so the "first = priority LCP" pick is deterministic.
  urls.sort((a, b) => a.localeCompare(b));
  return urls;
}

// The prefix is part of the cache key so changing HERO_IMAGES_BLOB_PREFIX picks
// up the new folder immediately instead of serving the old one for a day.
const listHeroImagesCached = unstable_cache(listHeroImages, ['hero-images', HERO_BLOB_PREFIX], {
  revalidate: REVALIDATE_SECONDS,
  tags: ['hero-images'],
});

/**
 * The hero image URLs, from the "Hero Images/" Vercel Blob folder, cached in the
 * shared Data Cache for a day (see the caching note at the top of this file).
 * Always returns a non-empty list (falls back to the bundled assets).
 */
export async function getHeroImages(): Promise<string[]> {
  // list() needs a read/write token; without it, use the bundled assets.
  if (!HERO_BLOB_TOKEN) return HERO_IMAGES;

  try {
    const urls = await listHeroImagesCached();
    return urls.length ? urls : HERO_IMAGES;
  } catch (err) {
    console.error('[heroImages] blob list failed; using bundled assets:', err);
    return HERO_IMAGES;
  }
}
