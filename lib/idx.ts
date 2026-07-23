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
import { DISPLAYABLE_STANDARD_STATUSES, showsFullGallery } from './idxSync';

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
/**
 * The subject-property attributes the similarity ranker reads. Shared by the
 * for-sale (`SimilarHomesParams`) and sold-comp (`SoldCompsParams`) callers so a
 * single ranking function serves both lists.
 */
export interface ComparableSubject {
  latitude?: number | null;
  longitude?: number | null;
  estimatedValue?: number | null;
  city?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  propertyType?: string | null;
}

export interface SimilarHomesParams extends ComparableSubject {
  priceRangeLow: number;
  priceRangeHigh: number;
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
export function similarityScore(subject: ComparableSubject, cand: IdxListing): number {
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

  // Price — relative difference from the subject's estimate. For a SOLD comp use
  // what it actually sold for (closePrice); Active listings have no closePrice, so
  // this falls back to listPrice and the for-sale ranking is unchanged.
  const subjPrice = subject.estimatedValue ?? null;
  const candPrice = cand.closePrice ?? cand.listPrice;
  if (subjPrice != null && subjPrice > 0 && candPrice != null) {
    score += (Math.abs(subjPrice - candPrice) / Math.max(subjPrice, 50_000)) * 2;
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
/**
 * HOW RECENTLY-SOLD COMPS ARE CHOSEN
 * ----------------------------------
 * Same philosophy as Similar Homes (above). When we have the subject's
 * coordinates we pull a candidate pool of recent closed sales ordered by
 * geographic nearness — NOT hard-gated to the subject's mailing city — then rank
 * the pool by the shared `similarityScore` (attribute + proximity aware) plus a
 * light recency tiebreaker. So a genuinely closer, more-comparable sale one town
 * over can surface, and a far in-city sale can't crowd out a near one. A radius
 * guardrail keeps a dropped city gate from surfacing a distant "comp".
 *
 * When the subject has NO coordinates, proximity is unevaluable, so we fall back
 * to the previous behavior: same mailing city (if known), most-recent first.
 */
export interface SoldCompsParams extends ComparableSubject {
  withinDays?: number;
  limit?: number;
  /** Prefer comps within this many miles of the subject before widening. */
  maxRadiusMiles?: number;
}

export interface SoldRankOptions {
  limit?: number;
  maxRadiusMiles?: number;
  withinDays?: number;
  now?: Date;
}

/**
 * Rank a pool of closed comps for a subject property (pure, unit-tested). Sorts
 * by `similarityScore` (attribute + proximity) plus a small recency tiebreaker,
 * preferring comps within `maxRadiusMiles` and widening to the full (already
 * nearest-first) pool only when too few close comps exist. Lower rank = better.
 */
export function rankSoldComps(
  subject: ComparableSubject,
  pool: IdxListing[],
  options: SoldRankOptions = {},
): IdxListing[] {
  const { limit = 6, maxRadiusMiles = 15, withinDays = 90, now = new Date() } = options;
  const hasSubjectCoords = subject.latitude != null && subject.longitude != null;

  const scored = pool.map((row) => {
    const miles =
      hasSubjectCoords && row.latitude != null && row.longitude != null
        ? approxMiles(subject.latitude!, subject.longitude!, row.latitude, row.longitude)
        : null;
    let rank = similarityScore(subject, row);
    // Recency tiebreaker: up to +0.5 for the oldest sale in the window, ~0 for a
    // fresh one — small enough to only separate otherwise-comparable comps.
    if (row.closeDate) {
      const ageDays = (now.getTime() - new Date(row.closeDate).getTime()) / 86_400_000;
      rank += Math.max(0, Math.min(1, ageDays / withinDays)) * 0.5;
    }
    return { row, miles, rank };
  });

  // Prefer comps inside the radius guardrail; fall back to the whole pool only
  // when too few close comps exist, so thin markets still return something.
  const within = scored.filter((s) => s.miles != null && s.miles <= maxRadiusMiles);
  const base = within.length >= limit ? within : scored;
  return base
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.row);
}

export async function getRecentSoldComps(params: SoldCompsParams): Promise<IdxCard[]> {
  const { latitude, longitude, city, withinDays = 90, limit = 6, maxRadiusMiles = 15 } = params;
  const hasCoords = latitude != null && longitude != null;
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);

  // No coordinates → proximity is unevaluable; keep the city-scoped, most-recent
  // behavior (mirrors the routing "unevaluable vs. out-of-area" split).
  if (!hasCoords) {
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
      .orderBy(sql`${idxListings.closeDate} DESC`)
      .limit(limit);
    return rows.map(gateAddress);
  }

  // With coordinates → pull a nearest-first candidate pool (no city gate) and
  // rank it by attribute + proximity similarity.
  const pool = await db
    .select()
    .from(idxListings)
    .where(
      and(
        eq(idxListings.standardStatus, 'Closed'),
        notLease,
        gte(idxListings.closeDate, cutoff),
        isNotNull(idxListings.photoUrl),
        canDisplay,
      ),
    )
    .orderBy(
      sql`ABS(COALESCE(${idxListings.latitude}, 0) - ${latitude}) + ABS(COALESCE(${idxListings.longitude}, 0) - ${longitude}) ASC`,
    )
    .limit(150);

  const ranked = rankSoldComps(params, pool, { limit, maxRadiusMiles, withinDays });
  return ranked.map(gateAddress);
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
 * Full photo set for gallery-eligible statuses (Active + Active Under Contract);
 * primary-only for Pending/Closed (only pending and sold are capped at the
 * primary photo per §18.10). Returns media URLs in display order.
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
  return showsFullGallery(standardStatus) ? urls : urls.slice(0, 1);
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

// ---------------------------------------------------------------------------
// Rich market report (the designed "Market Report" card) — headline stats,
// year-over-year, and a trailing-12-month median price series.
// ---------------------------------------------------------------------------
export interface MarketTrendPoint {
  label: string; // e.g. "Jul '25"
  median: number | null;
}

export interface CityMarketReport {
  city: string;
  periodLabel: string; // e.g. "Q2 2026"
  medianSalePrice: number | null;
  yoyChangePct: number | null; // median now vs. same 90d window a year ago
  medianPricePerSqft: number | null;
  avgDaysOnMarket: number | null;
  listToSaleRatio: number | null; // percent
  homesSold90d: number;
  soldAboveAskingPct: number | null;
  monthsOfInventory: number | null;
  activeListings: number;
  trailing: MarketTrendPoint[]; // 12 monthly points, oldest → newest
  trailing12ChangeAbs: number | null; // newest median − oldest available median
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Full market-report dataset for a city (IDX Closed sales, leases excluded). */
export async function getCityMarketReport(city: string): Promise<CityMarketReport | null> {
  if (!city.trim()) return null;

  const headline = await db.execute(sql`
    WITH sales90 AS (
      SELECT close_price, list_price, days_on_market, living_area
      FROM idx_listings
      WHERE standard_status = 'Closed'
        AND LOWER(city) = LOWER(${city})
        AND close_date >= now() - interval '90 days'
        AND close_price IS NOT NULL
        AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))
    ),
    sales_prior_year AS (
      SELECT close_price
      FROM idx_listings
      WHERE standard_status = 'Closed'
        AND LOWER(city) = LOWER(${city})
        AND close_date >= now() - interval '1 year 90 days'
        AND close_date <  now() - interval '1 year'
        AND close_price IS NOT NULL
        AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))
    )
    SELECT
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price) FROM sales90) AS median_price,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price) FROM sales_prior_year) AS median_price_prev,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price::float / NULLIF(living_area, 0))
         FROM sales90 WHERE living_area IS NOT NULL AND living_area > 0) AS median_ppsf,
      (SELECT avg(days_on_market) FROM sales90 WHERE days_on_market IS NOT NULL) AS avg_dom,
      (SELECT avg(close_price::float / NULLIF(list_price, 0)) * 100
         FROM sales90 WHERE list_price IS NOT NULL AND list_price > 0) AS list_to_sale,
      (SELECT count(*) FROM sales90) AS homes_90,
      (SELECT count(*) FILTER (WHERE close_price > list_price)::float / NULLIF(count(*), 0) * 100
         FROM sales90 WHERE list_price IS NOT NULL AND list_price > 0) AS above_asking_pct,
      (SELECT count(*) FROM idx_listings
         WHERE standard_status = 'Active' AND LOWER(city) = LOWER(${city})
           AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))) AS active_count,
      (SELECT count(*) FROM idx_listings
         WHERE standard_status = 'Closed' AND LOWER(city) = LOWER(${city})
           AND close_date >= now() - interval '30 days'
           AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))) AS closed_30
  `);

  const monthly = await db.execute(sql`
    SELECT to_char(date_trunc('month', close_date), 'YYYY-MM') AS m,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price) AS med
    FROM idx_listings
    WHERE standard_status = 'Closed'
      AND LOWER(city) = LOWER(${city})
      AND close_date >= date_trunc('month', now()) - interval '11 months'
      AND close_price IS NOT NULL
      AND (property_type IS NULL OR (lower(property_type) NOT LIKE '%lease%' AND lower(property_type) NOT LIKE '%rent%'))
    GROUP BY 1 ORDER BY 1
  `);

  const h = (headline.rows?.[0] ?? {}) as Record<string, unknown>;
  const medianSalePrice = toNum(h.median_price) != null ? Math.round(toNum(h.median_price)!) : null;
  const medianPrev = toNum(h.median_price_prev);
  const yoyChangePct =
    medianSalePrice != null && medianPrev != null && medianPrev > 0
      ? Math.round(((medianSalePrice - medianPrev) / medianPrev) * 1000) / 10
      : null;
  const activeListings = toNum(h.active_count) ?? 0;
  const closed30 = toNum(h.closed_30) ?? 0;
  const moi = closed30 > 0 ? Math.round((activeListings / closed30) * 10) / 10 : null;

  // Build 12 monthly buckets (oldest → newest), filling gaps with null.
  const map = new Map<string, number | null>();
  for (const row of (monthly.rows ?? []) as Record<string, unknown>[]) {
    const k = String(row.m);
    map.set(k, toNum(row.med) != null ? Math.round(toNum(row.med)!) : null);
  }
  const now = new Date();
  const trailing: MarketTrendPoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trailing.push({ label: `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, median: map.get(key) ?? null });
  }
  const nonNull = trailing.filter((t) => t.median != null);
  const trailing12ChangeAbs =
    nonNull.length >= 2 ? (nonNull[nonNull.length - 1].median! - nonNull[0].median!) : null;

  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const periodLabel = `Q${quarter} ${now.getFullYear()}`;

  return {
    city,
    periodLabel,
    medianSalePrice,
    yoyChangePct,
    medianPricePerSqft: toNum(h.median_ppsf) != null ? Math.round(toNum(h.median_ppsf)!) : null,
    avgDaysOnMarket: toNum(h.avg_dom) != null ? Math.round(toNum(h.avg_dom)!) : null,
    listToSaleRatio: toNum(h.list_to_sale) != null ? Math.round(toNum(h.list_to_sale)! * 10) / 10 : null,
    homesSold90d: toNum(h.homes_90) ?? 0,
    soldAboveAskingPct: toNum(h.above_asking_pct) != null ? Math.round(toNum(h.above_asking_pct)!) : null,
    monthsOfInventory: moi,
    activeListings,
    trailing,
    trailing12ChangeAbs,
  };
}
