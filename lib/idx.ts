/**
 * IDX read queries for the consumer-facing features (IDX spec §4–§5).
 *
 * Every public query enforces the IDX display rules at the data layer:
 *   - only Active / Pending / Closed (never Expired / Withdrawn — §18.3.9)
 *   - exclude listings the agent hid entirely (internetEntireListingDisplayYN)
 *   - address is nulled when the agent hid the address (internetAddressDisplayYN)
 * so a caller physically cannot render a non-compliant listing.
 *
 * Leases/rentals are excluded from valuation comps (Similar Homes For Sale +
 * Recently Sold) — a rental's "price" is monthly rent, so it is neither a
 * comparable sale nor a comparable for-sale home.
 */
import { and, or, eq, gte, lte, isNull, isNotNull, sql, asc, inArray } from 'drizzle-orm';
import { db } from './db';
import { idxListings, idxListingPhotos, type IdxListing } from '../drizzle/schema';
import { DISPLAYABLE_STANDARD_STATUSES } from './idxSync';

/** A listing prepared for public display: address already compliance-gated. */
export type IdxCard = IdxListing;

/** WHERE fragment: listing may be shown at all (entire-listing display gate). */
const canDisplay = or(
  eq(idxListings.internetEntireListingDisplayYN, true),
  isNull(idxListings.internetEntireListingDisplayYN),
);

/**
 * WHERE fragment: the listing is a SALE, not a lease/rental. Realcomp encodes
 * leases in PropertyType ("Residential Lease", "Commercial Lease") and
 * occasionally PropertySubType; exclude anything mentioning lease/rental in
 * either. Null types are kept (assumed sale) so we don't drop real comps.
 */
const notLease = and(
  or(
    isNull(idxListings.propertyType),
    and(
      sql`lower(${idxListings.propertyType}) not like '%lease%'`,
      sql`lower(${idxListings.propertyType}) not like '%rent%'`,
    ),
  ),
  or(
    isNull(idxListings.propertySubType),
    and(
      sql`lower(${idxListings.propertySubType}) not like '%lease%'`,
      sql`lower(${idxListings.propertySubType}) not like '%rent%'`,
    ),
  ),
);

/** Null the address when the listing agent hid it (§18.2.3 / spec §2.2). */
function gateAddress<T extends IdxListing>(row: T): T {
  if (row.internetAddressDisplayYN === false) return { ...row, address: null };
  return row;
}

// ---------------------------------------------------------------------------
// Similar Homes — active listings near the subject property (IDX spec §4.2)
// ---------------------------------------------------------------------------
/**
 * HOW SIMILAR HOMES ARE CHOSEN
 * ----------------------------
 * We do NOT just take the nearest homes in a price band. We pull a candidate
 * pool of active, non-lease, displayable listings around the subject's price,
 * then rank every candidate by a similarity SCORE that matches as many of the
 * subject's attributes as possible (lower score = more similar):
 *
 *   • Location   — same mailing city is a strong match; geographic distance
 *                  (when coordinates exist) adds a graduated penalty.
 *   • Beds/Baths — absolute difference in bedroom and bathroom count.
 *   • Living area— relative difference in square footage.
 *   • Type       — single-family vs condo vs multi-family match.
 *   • Year built — difference in age.
 *   • Price      — relative difference from the subject's estimated value.
 *
 * Each term only contributes when BOTH the subject and the candidate have the
 * value, so a listing with missing data isn't unfairly penalised. The top N by
 * score are returned. This makes the "similar homes" genuinely comparable
 * rather than merely nearby or merely similarly priced.
 */
export interface SimilarHomesParams {
  latitude?: number | null;
  longitude?: number | null;
  priceRangeLow: number;
  priceRangeHigh: number;
  /** Subject-property attributes for similarity ranking (all optional). */
  estimatedValue?: number | null;
  city?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  propertyType?: string | null;
  limit?: number;
}

/** Rough miles between two lat/lng points (equirectangular approximation). */
function approxMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 69; // ~69 miles per degree latitude
  const dLng = (bLng - aLng) * 69 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Coarse property-family bucket so "Single Family Residence" ≈ "Single Family". */
export function propertyFamily(...values: (string | null | undefined)[]): string | null {
  const s = values.filter(Boolean).join(' ').toLowerCase();
  if (!s) return null;
  if (/(condo|apartment|co-?op)/.test(s)) return 'condo';
  if (/(multi|duplex|triplex|fourplex|2 unit|income)/.test(s)) return 'multi';
  if (/(land|lot|acre|vacant)/.test(s)) return 'land';
  if (/(single|residential|detached|ranch|colonial|bungalow|cape)/.test(s)) return 'single';
  return null;
}

/** Similarity distance for one candidate vs. the subject (lower = closer). */
export function similarityScore(subject: SimilarHomesParams, cand: IdxListing): number {
  let score = 0;

  // Location — same city is a strong signal; distance adds a graded penalty.
  const subjCity = subject.city?.trim().toLowerCase();
  const candCity = cand.city?.trim().toLowerCase();
  if (subjCity && candCity) score += subjCity === candCity ? 0 : 3;
  if (
    subject.latitude != null &&
    subject.longitude != null &&
    cand.latitude != null &&
    cand.longitude != null
  ) {
    score += approxMiles(subject.latitude, subject.longitude, cand.latitude, cand.longitude) * 0.15;
  }

  // Beds / baths — absolute difference.
  if (subject.beds != null && cand.bedsTotal != null) score += Math.abs(subject.beds - cand.bedsTotal) * 1.0;
  if (subject.baths != null && cand.bathsTotal != null) score += Math.abs(subject.baths - cand.bathsTotal) * 1.0;

  // Living area — relative difference (100% off ≈ +3).
  if (subject.sqft != null && subject.sqft > 0 && cand.livingArea != null) {
    score += (Math.abs(subject.sqft - cand.livingArea) / Math.max(subject.sqft, 500)) * 3;
  }

  // Property family — single vs condo vs multi.
  const subjFam = propertyFamily(subject.propertyType);
  const candFam = propertyFamily(cand.propertySubType, cand.propertyType);
  if (subjFam && candFam) score += subjFam === candFam ? 0 : 1.5;

  // Year built — difference in age (30 yrs ≈ +1).
  if (subject.yearBuilt != null && cand.yearBuilt != null) {
    score += (Math.abs(subject.yearBuilt - cand.yearBuilt) / 30) * 1.0;
  }

  // Price — relative difference from the subject's estimate.
  const subjPrice = subject.estimatedValue ?? null;
  if (subjPrice != null && subjPrice > 0 && cand.listPrice != null) {
    score += (Math.abs(subjPrice - cand.listPrice) / Math.max(subjPrice, 50_000)) * 2;
  }

  return score;
}

export async function getSimilarHomes(params: SimilarHomesParams): Promise<IdxCard[]> {
  const { latitude, longitude, priceRangeLow, priceRangeHigh, limit = 6 } = params;
  const hasCoords = latitude != null && longitude != null;

  // Pull a widened candidate pool (a bit beyond the display band) so the
  // multi-field ranker has room to find genuinely-similar homes, keeping the
  // geographically closest when the pool overflows.
  const poolLow = Math.round(priceRangeLow * 0.85);
  const poolHigh = Math.round(priceRangeHigh * 1.15);

  const pool = await db
    .select()
    .from(idxListings)
    .where(
      and(
        eq(idxListings.standardStatus, 'Active'),
        notLease,
        gte(idxListings.listPrice, poolLow),
        lte(idxListings.listPrice, poolHigh),
        isNotNull(idxListings.photoUrl),
        canDisplay,
      ),
    )
    .orderBy(
      hasCoords
        ? sql`ABS(COALESCE(${idxListings.latitude}, 0) - ${latitude}) + ABS(COALESCE(${idxListings.longitude}, 0) - ${longitude}) ASC`
        : sql`${idxListings.modificationTimestamp} DESC`,
    )
    .limit(100);

  const ranked = pool
    .map((row) => ({ row, score: similarityScore(params, row) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((r) => r.row);

  return ranked.map(gateAddress);
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
        notLease,
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
// Single listing — for the listing detail page (§18.3.3 detail view)
// ---------------------------------------------------------------------------
/** Statuses we are allowed to display (§18.3.9 bars expired/withdrawn). */
const DISPLAYABLE_STATUSES = new Set<string>(DISPLAYABLE_STANDARD_STATUSES);

/**
 * Fetch one listing by its key for the detail page. Returns null when the
 * listing does not exist, is not in a displayable status, or the listing agent
 * has hidden the entire listing from IDX — so a detail URL can never render a
 * non-compliant listing. Address is gated the same as the grids.
 */
export async function getListingByKey(listingKey: string): Promise<IdxCard | null> {
  if (!listingKey.trim()) return null;
  const rows = await db
    .select()
    .from(idxListings)
    .where(and(eq(idxListings.listingKey, listingKey), canDisplay))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!DISPLAYABLE_STATUSES.has(row.standardStatus)) return null;
  return gateAddress(row);
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

  // Sales only (exclude leases) so the median "sale price" isn't polluted by
  // monthly rents, and active-listing/inventory counts reflect homes for sale.
  const result = await db.execute(sql`
    WITH closed90 AS (
      SELECT days_on_market, close_price, list_price
      FROM idx_listings
      WHERE standard_status = 'Closed'
        AND LOWER(city) = LOWER(${city})
        AND close_date >= ${ninetyAgo}
        AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))
    )
    SELECT
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days_on_market)
         FROM closed90 WHERE days_on_market IS NOT NULL) AS median_dom,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price)
         FROM closed90 WHERE close_price IS NOT NULL) AS median_price,
      (SELECT AVG(close_price::float / NULLIF(list_price, 0)) * 100
         FROM closed90 WHERE close_price IS NOT NULL AND list_price IS NOT NULL) AS avg_ratio,
      (SELECT COUNT(*) FROM idx_listings
         WHERE standard_status = 'Active' AND LOWER(city) = LOWER(${city})
           AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))) AS active_count,
      (SELECT COUNT(*) FROM idx_listings
         WHERE standard_status = 'Closed' AND LOWER(city) = LOWER(${city})
           AND close_date >= ${thirtyAgo}
           AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))) AS closed_30
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
