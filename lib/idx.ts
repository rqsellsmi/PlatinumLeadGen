/**
 * IDX read queries for the consumer-facing features (IDX spec §4–§5).
 *
 * Every public query enforces the IDX display rules at the data layer:
 *   - only Active / Pending / Closed (never Expired / Withdrawn — §18.3.9)
 *   - exclude listings the agent hid entirely (internetEntireListingDisplayYN)
 *   - address is nulled when the agent hid the address (internetAddressDisplayYN)
 * so a caller physically cannot render a non-compliant listing.
 */
import { and, or, eq, gte, lte, isNull, isNotNull, sql, asc, inArray } from 'drizzle-orm';
import { db } from './db';
import { idxListings, idxListingPhotos, type IdxListing } from '../drizzle/schema';

/** A listing prepared for public display: address already compliance-gated. */
export type IdxCard = IdxListing;

/** WHERE fragment: listing may be shown at all (entire-listing display gate). */
const canDisplay = or(
  eq(idxListings.internetEntireListingDisplayYN, true),
  isNull(idxListings.internetEntireListingDisplayYN),
);

/** Null the address when the listing agent hid it (§18.2.3 / spec §2.2). */
function gateAddress<T extends IdxListing>(row: T): T {
  if (row.internetAddressDisplayYN === false) return { ...row, address: null };
  return row;
}

// ---------------------------------------------------------------------------
// Similar Homes — active listings near the subject property (IDX spec §4.2)
// ---------------------------------------------------------------------------
export interface SimilarHomesParams {
  latitude?: number | null;
  longitude?: number | null;
  priceRangeLow: number;
  priceRangeHigh: number;
  limit?: number;
}

export async function getSimilarHomes(params: SimilarHomesParams): Promise<IdxCard[]> {
  const { latitude, longitude, priceRangeLow, priceRangeHigh, limit = 6 } = params;
  const hasCoords = latitude != null && longitude != null;

  const rows = await db
    .select()
    .from(idxListings)
    .where(
      and(
        eq(idxListings.standardStatus, 'Active'),
        gte(idxListings.listPrice, Math.round(priceRangeLow)),
        lte(idxListings.listPrice, Math.round(priceRangeHigh)),
        isNotNull(idxListings.photoUrl),
        canDisplay,
      ),
    )
    .orderBy(
      hasCoords
        ? sql`ABS(COALESCE(${idxListings.latitude}, 0) - ${latitude}) + ABS(COALESCE(${idxListings.longitude}, 0) - ${longitude}) ASC`
        : sql`${idxListings.modificationTimestamp} DESC`,
    )
    .limit(limit);

  return rows.map(gateAddress);
}

// ---------------------------------------------------------------------------
// Recent Sold Comps — closed listings near the subject (IDX spec §5.2 §2)
// ---------------------------------------------------------------------------
export interface SoldCompsParams {
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  withinDays?: number;
  limit?: number;
}

export async function getRecentSoldComps(params: SoldCompsParams): Promise<IdxCard[]> {
  const { latitude, longitude, city, withinDays = 90, limit = 6 } = params;
  const hasCoords = latitude != null && longitude != null;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(idxListings)
    .where(
      and(
        eq(idxListings.standardStatus, 'Closed'),
        gte(idxListings.closeDate, cutoff),
        isNotNull(idxListings.photoUrl),
        canDisplay,
        city ? sql`LOWER(${idxListings.city}) = LOWER(${city})` : undefined,
      ),
    )
    .orderBy(
      hasCoords
        ? sql`ABS(COALESCE(${idxListings.latitude}, 0) - ${latitude}) + ABS(COALESCE(${idxListings.longitude}, 0) - ${longitude}) ASC`
        : sql`${idxListings.closeDate} DESC`,
    )
    .limit(limit);

  return rows.map(gateAddress);
}

// ---------------------------------------------------------------------------
// Photos — all photos for a listing, gated by status (IDX Rules §18.10)
// ---------------------------------------------------------------------------
/**
 * Full photo set for Active listings; primary-only for Pending/Closed (Pending
 * and Sold may show ONLY the primary photo per §18.10). Returns media URLs in
 * display order.
 */
export async function getListingPhotos(
  listingKey: string,
  standardStatus: string,
): Promise<string[]> {
  const rows = await db
    .select({ url: idxListingPhotos.mediaUrl })
    .from(idxListingPhotos)
    .where(eq(idxListingPhotos.listingKey, listingKey))
    .orderBy(asc(idxListingPhotos.sortOrder));
  const urls = rows.map((r) => r.url);
  return standardStatus === 'Active' ? urls : urls.slice(0, 1);
}

/**
 * Bulk photo fetch for a set of listings, returned as listingKey → ordered
 * media URLs. Callers apply the §18.10 status gate (full set for Active,
 * primary-only for Pending/Closed) per listing.
 */
export async function getPhotosForListings(
  listingKeys: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (listingKeys.length === 0) return map;
  const rows = await db
    .select({ key: idxListingPhotos.listingKey, url: idxListingPhotos.mediaUrl })
    .from(idxListingPhotos)
    .where(inArray(idxListingPhotos.listingKey, listingKeys))
    .orderBy(asc(idxListingPhotos.listingKey), asc(idxListingPhotos.sortOrder));
  for (const r of rows) {
    const arr = map.get(r.key) ?? [];
    arr.push(r.url);
    map.set(r.key, arr);
  }
  return map;
}

// ---------------------------------------------------------------------------
// City market trend stats (IDX spec §5.2 §4)
// ---------------------------------------------------------------------------
export interface CityMarketStats {
  medianDaysOnMarket: number | null;
  medianSalePrice: number | null;
  avgSaleToListRatio: number | null; // percent, e.g. 98.4
  activeListings: number;
  monthsOfInventory: number | null;
}

export async function getCityMarketStats(city: string): Promise<CityMarketStats | null> {
  if (!city.trim()) return null;
  const ninetyAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    WITH closed90 AS (
      SELECT days_on_market, close_price, list_price
      FROM idx_listings
      WHERE standard_status = 'Closed'
        AND LOWER(city) = LOWER(${city})
        AND close_date >= ${ninetyAgo}
    )
    SELECT
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days_on_market)
         FROM closed90 WHERE days_on_market IS NOT NULL) AS median_dom,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price)
         FROM closed90 WHERE close_price IS NOT NULL) AS median_price,
      (SELECT AVG(close_price::float / NULLIF(list_price, 0)) * 100
         FROM closed90 WHERE close_price IS NOT NULL AND list_price IS NOT NULL) AS avg_ratio,
      (SELECT COUNT(*) FROM idx_listings
         WHERE standard_status = 'Active' AND LOWER(city) = LOWER(${city})) AS active_count,
      (SELECT COUNT(*) FROM idx_listings
         WHERE standard_status = 'Closed' AND LOWER(city) = LOWER(${city})
           AND close_date >= ${thirtyAgo}) AS closed_30
  `);

  const r = (result.rows?.[0] ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const activeListings = num(r.active_count) ?? 0;
  const closed30 = num(r.closed_30) ?? 0;
  const monthsOfInventory = closed30 > 0 ? activeListings / closed30 : null;

  return {
    medianDaysOnMarket: num(r.median_dom) != null ? Math.round(num(r.median_dom)!) : null,
    medianSalePrice: num(r.median_price) != null ? Math.round(num(r.median_price)!) : null,
    avgSaleToListRatio: num(r.avg_ratio) != null ? Math.round(num(r.avg_ratio)! * 10) / 10 : null,
    activeListings,
    monthsOfInventory: monthsOfInventory != null ? Math.round(monthsOfInventory * 10) / 10 : null,
  };
}
