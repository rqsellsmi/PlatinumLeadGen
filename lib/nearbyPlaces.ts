/**
 * Neighborhood highlights — nearby restaurants, parks, coffee, groceries, gas,
 * gyms, pharmacies, medical care, and golf around a listing, via the Google
 * Places Nearby Search API (server-side). Powers the "area report" section of
 * the listing detail page (the ListReports-style Convenient / Outdoors / Eats
 * infographics, minus schools — we intentionally never fetch school POIs).
 *
 * COST CONTROL. Nearby Search is billed per request (~$32 / 1,000). Two guards
 * keep that bounded:
 *   1. Results are cached in `area_poi_cache`, keyed by a coarse ~110 m grid cell
 *      (lat/lng rounded to 3 decimals), so every listing on the same block reuses
 *      one lookup and repeat views cost $0.
 *   2. Each POI is stored with its OWN coordinates, so a cache hit recomputes the
 *      exact distance from the specific home — one cached cell serves many homes
 *      with accurate per-home distances.
 * Disable entirely with LISTING_AREA_POI=0 (or by leaving the Google key unset).
 *
 * Uses GOOGLE_MAPS_API_KEY (the unrestricted server key with the legacy Places
 * API enabled — the same key geocoding uses), falling back to the public key.
 * Never called from the browser.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { areaPoiCache, apiUsageLogs } from '../drizzle/schema';
import { haversine } from './routing';

/** A resolved nearby place with its own coordinates (for per-home distance). */
export interface Poi {
  category: string;
  name: string;
  lat: number;
  lng: number;
  vicinity?: string | null;
}

/** One category rendered on the page: the nearest place + how many are close by. */
export interface AreaCategory {
  key: string;
  label: string;
  group: 'everyday' | 'outdoors' | 'dining';
  nearest: { name: string; distanceMiles: number; vicinity?: string | null } | null;
  countWithinRadius: number; // places within RADIUS_MILES
}

export interface AreaReport {
  categories: AreaCategory[];
  fetchedAt: Date;
}

/**
 * The POI categories we surface. `type` uses a Google Places place type;
 * `keyword` uses a text match (for concepts without a dedicated type, e.g. golf).
 * Schools are deliberately absent. Ordered as they render.
 */
interface CategorySpec {
  key: string;
  label: string;
  group: 'everyday' | 'outdoors' | 'dining';
  type?: string;
  keyword?: string;
}
export const AREA_CATEGORIES: CategorySpec[] = [
  { key: 'restaurant', label: 'Restaurants', group: 'dining', type: 'restaurant' },
  { key: 'cafe', label: 'Coffee', group: 'dining', type: 'cafe' },
  { key: 'grocery', label: 'Groceries', group: 'everyday', type: 'supermarket' },
  { key: 'gas', label: 'Gas', group: 'everyday', type: 'gas_station' },
  { key: 'gym', label: 'Fitness', group: 'everyday', type: 'gym' },
  { key: 'pharmacy', label: 'Pharmacy', group: 'everyday', type: 'pharmacy' },
  { key: 'medical', label: 'Medical', group: 'everyday', keyword: 'urgent care clinic' },
  { key: 'park', label: 'Parks', group: 'outdoors', type: 'park' },
  { key: 'golf', label: 'Golf', group: 'outdoors', keyword: 'golf course' },
];

/** Places within this radius (mi) count toward "how many nearby". */
export const RADIUS_MILES = 5;
const CACHE_MAX_AGE_DAYS = 120;
const MAX_STORED_PER_CATEGORY = 12;

function key(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null;
}

/** Feature flag: default ON when a key exists; set LISTING_AREA_POI=0 to disable. */
export function areaPoiEnabled(): boolean {
  return process.env.LISTING_AREA_POI !== '0' && key() != null;
}

/** Coarse ~110 m grid-cell key so nearby listings share one cached lookup. */
export function geoKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

interface NearbyResult {
  name?: string;
  vicinity?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  business_status?: string;
}

/** One Nearby Search call for a category, ranked by distance. Returns [] on any failure. */
async function fetchCategory(lat: number, lng: number, spec: CategorySpec, k: string): Promise<Poi[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  // rankby=distance returns nearest-first (no radius allowed) and requires a
  // type/keyword/name — we always pass one, so results come back closest-first.
  url.searchParams.set('rankby', 'distance');
  if (spec.type) url.searchParams.set('type', spec.type);
  if (spec.keyword) url.searchParams.set('keyword', spec.keyword);
  url.searchParams.set('key', k);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`places ${res.status}`);
  const data = (await res.json()) as { status?: string; results?: NearbyResult[]; error_message?: string };
  // ZERO_RESULTS is a valid empty answer, not an error.
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`${data.status}: ${data.error_message ?? ''}`.trim());
  }
  const out: Poi[] = [];
  for (const r of data.results ?? []) {
    if (r.business_status && r.business_status !== 'OPERATIONAL') continue;
    const plat = r.geometry?.location?.lat;
    const plng = r.geometry?.location?.lng;
    const name = r.name?.trim();
    if (plat == null || plng == null || !name) continue;
    out.push({ category: spec.key, name, lat: plat, lng: plng, vicinity: r.vicinity ?? null });
    if (out.length >= MAX_STORED_PER_CATEGORY) break;
  }
  return out;
}

async function logUsage(success: boolean, count: number, errorMessage: string | null, ms: number): Promise<void> {
  try {
    await db.insert(apiUsageLogs).values({
      service: 'google-places',
      endpoint: '/place/nearbysearch',
      ip: 'server',
      statusCode: success ? 200 : 502,
      success,
      errorMessage,
      responseTimeMs: ms,
      meta: `pois=${count}`,
    });
  } catch (err) {
    console.warn('[nearbyPlaces] usage log failed:', err);
  }
}

/** Fetch every category around a point (one Places call each). Partial failures are tolerated. */
async function fetchAll(lat: number, lng: number, k: string): Promise<Poi[]> {
  const start = Date.now();
  const settled = await Promise.allSettled(AREA_CATEGORIES.map((spec) => fetchCategory(lat, lng, spec, k)));
  const pois: Poi[] = [];
  let firstError: string | null = null;
  for (const s of settled) {
    if (s.status === 'fulfilled') pois.push(...s.value);
    else if (!firstError) firstError = s.reason instanceof Error ? s.reason.message : String(s.reason);
  }
  const anyOk = settled.some((s) => s.status === 'fulfilled');
  await logUsage(anyOk, pois.length, anyOk ? null : firstError, Date.now() - start);
  return pois;
}

/** Build the render-ready category list from stored POIs + the exact home coords. */
function summarize(pois: Poi[], lat: number, lng: number): AreaCategory[] {
  return AREA_CATEGORIES.map((spec) => {
    const withDist = pois
      .filter((p) => p.category === spec.key)
      .map((p) => ({ ...p, d: haversine(lat, lng, p.lat, p.lng) }))
      .sort((a, b) => a.d - b.d);
    const nearest = withDist[0]
      ? { name: withDist[0].name, distanceMiles: withDist[0].d, vicinity: withDist[0].vicinity }
      : null;
    return {
      key: spec.key,
      label: spec.label,
      group: spec.group,
      nearest,
      countWithinRadius: withDist.filter((p) => p.d <= RADIUS_MILES).length,
    };
  }).filter((c) => c.nearest != null);
}

/**
 * Get the neighborhood highlights around a listing. Returns the cached cell when
 * fresh, otherwise fetches live, caches, and logs. Returns null when disabled,
 * un-keyed, or the lookup yielded nothing usable.
 */
export async function getAreaReport(
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<AreaReport | null> {
  if (lat == null || lng == null || !areaPoiEnabled()) return null;
  const k = key();
  if (!k) return null;
  const gk = geoKey(lat, lng);

  // ---- Cache read ----------------------------------------------------------
  try {
    const rows = await db.select().from(areaPoiCache).where(eq(areaPoiCache.geoKey, gk)).limit(1);
    const row = rows[0];
    if (row?.payloadJson) {
      const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
      if (ageMs < CACHE_MAX_AGE_DAYS * 86_400_000) {
        const pois = JSON.parse(row.payloadJson) as Poi[];
        const categories = summarize(pois, lat, lng);
        return categories.length ? { categories, fetchedAt: new Date(row.fetchedAt) } : null;
      }
    }
  } catch (err) {
    console.warn('[nearbyPlaces] cache read failed:', err);
  }

  // ---- Live fetch ----------------------------------------------------------
  let pois: Poi[];
  try {
    pois = await fetchAll(lat, lng, k);
  } catch (err) {
    console.error('[nearbyPlaces] live fetch failed:', err);
    return null;
  }

  // ---- Cache write (best-effort) ------------------------------------------
  const fetchedAt = new Date();
  try {
    await db
      .insert(areaPoiCache)
      .values({ geoKey: gk, latitude: lat, longitude: lng, payloadJson: JSON.stringify(pois), fetchedAt })
      .onConflictDoUpdate({
        target: areaPoiCache.geoKey,
        set: { latitude: lat, longitude: lng, payloadJson: JSON.stringify(pois), error: null, fetchedAt },
      });
  } catch (err) {
    console.warn('[nearbyPlaces] cache write failed:', err);
  }

  const categories = summarize(pois, lat, lng);
  return categories.length ? { categories, fetchedAt } : null;
}
