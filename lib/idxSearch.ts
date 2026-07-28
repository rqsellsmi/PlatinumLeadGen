/**
 * Public buyer-facing home search over the IDX mirror (`idx_listings`) — the
 * SERVER query. Enforces the same compliance gates as `lib/idx.ts`
 * (entire-listing display, lease exclusion, address gating) plus a for-sale
 * status restriction, and adds the geo + attribute predicates a buyer search
 * needs. Pure helpers/types live in `lib/listingSearch.ts` (client-safe).
 *
 * NB: never filter on the six Realcomp zero-out columns (architecturalStyle,
 * interiorFeatures, appliances, parkingFeatures, lotFeatures, associationAmenities)
 * — they are NULL in the DB (lessons §16b).
 */
import { and, or, eq, gte, lte, ilike, inArray, sql, asc, desc } from 'drizzle-orm';
import { db } from './db';
import { idxListings } from '../drizzle/schema';
import { canDisplay, notLease, notCommercial, gateAddress, approxMiles, type IdxCard } from './idx';
import {
  FOR_SALE_STATUSES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_REGION,
  boundingBox,
  bboxFromRadius,
  pointInPolygon,
  type SearchFilters,
  type SearchSort,
  type BBox,
  type LatLng,
} from './listingSearch';

export type { SearchFilters } from './listingSearch';

export interface SearchResult {
  rows: IdxCard[];
  total: number;
  page: number;
  pageSize: number;
}

/** Cap on the candidate pool pulled for in-JS geo filtering (polygon/radius). */
const GEO_CANDIDATE_CAP = 1500;

function buildConditions(f: SearchFilters, geoBox: BBox | null) {
  const conds: any[] = [
    inArray(idxListings.standardStatus, FOR_SALE_STATUSES as unknown as string[]),
    canDisplay,
    notLease,
    notCommercial, // homes search — exclude commercial/business categories
    // NOTE: no photo_url requirement — a for-sale home without a primary photo is
    // still a valid search result (the card renders a placeholder). Requiring a
    // photo here silently hid listings whose photo hadn't synced yet.
  ];
  if (f.priceMin != null) conds.push(gte(idxListings.listPrice, Math.round(f.priceMin)));
  if (f.priceMax != null) conds.push(lte(idxListings.listPrice, Math.round(f.priceMax)));
  if (f.bedsMin != null) conds.push(gte(idxListings.bedsTotal, Math.round(f.bedsMin)));
  if (f.bathsMin != null) conds.push(gte(idxListings.bathsTotal, f.bathsMin));
  if (f.city) {
    // Tolerant match: the core city token as a substring, so "Fenton, MI" or
    // "Fenton Twp" still finds a stored city of "Fenton" (and vice-versa).
    const core = f.city.split(',')[0].trim();
    if (core) conds.push(ilike(idxListings.city, `%${core}%`));
  }
  if (f.sqftMin != null) conds.push(gte(idxListings.livingArea, Math.round(f.sqftMin)));
  if (f.sqftMax != null) conds.push(lte(idxListings.livingArea, Math.round(f.sqftMax)));
  if (f.yearMin != null) conds.push(gte(idxListings.yearBuilt, Math.round(f.yearMin)));
  if (f.yearMax != null) conds.push(lte(idxListings.yearBuilt, Math.round(f.yearMax)));
  if (f.propertyTypes && f.propertyTypes.length) {
    // Space-insensitive match: Realcomp may return spaced ("Single Family
    // Residence") OR space-less enum tokens ("SingleFamilyResidence"), and may
    // carry the detail in property_type OR property_sub_type. Strip spaces on both
    // sides before comparing so either form matches.
    conds.push(
      or(
        ...f.propertyTypes.map((t) => {
          const needle = `%${t.toLowerCase().replace(/\s+/g, '')}%`;
          return or(
            sql`replace(lower(coalesce(${idxListings.propertyType}, '')), ' ', '') like ${needle}`,
            sql`replace(lower(coalesce(${idxListings.propertySubType}, '')), ' ', '') like ${needle}`,
          );
        }),
      ),
    );
  }
  if (f.lotAcresMin != null) conds.push(gte(idxListings.lotSizeAcres, f.lotAcresMin));
  if (f.garageMin != null) conds.push(gte(idxListings.garageSpaces, Math.round(f.garageMin)));
  if (f.waterfront) conds.push(eq(idxListings.waterfrontYN, true));
  if (f.pool) conds.push(eq(idxListings.poolPrivateYN, true));
  if (f.newConstruction) conds.push(eq(idxListings.newConstructionYN, true));
  if (f.hoaMax != null) {
    // Include listings with no HOA fee (null) OR fee at/under the cap.
    conds.push(or(sql`${idxListings.associationFee} IS NULL`, lte(idxListings.associationFee, f.hoaMax)));
  }
  if (f.domMax != null) conds.push(lte(idxListings.daysOnMarket, Math.round(f.domMax)));
  if (f.basementFinished) conds.push(sql`lower(${idxListings.basement}) like '%finished%'`);
  if (f.fireplace) conds.push(gte(idxListings.fireplacesTotal, 1));
  if (geoBox) {
    conds.push(gte(idxListings.latitude, geoBox.minLat));
    conds.push(lte(idxListings.latitude, geoBox.maxLat));
    conds.push(gte(idxListings.longitude, geoBox.minLng));
    conds.push(lte(idxListings.longitude, geoBox.maxLng));
  }
  return and(...conds);
}

function orderFor(sort: SearchSort | undefined) {
  switch (sort) {
    case 'price_asc':
      return asc(idxListings.listPrice);
    case 'price_desc':
      return desc(idxListings.listPrice);
    case 'dom':
      return asc(idxListings.daysOnMarket);
    case 'newest':
    default:
      // No true list-date column yet; days-on-market asc ≈ most recently listed.
      return asc(idxListings.daysOnMarket);
  }
}

export async function searchListings(f: SearchFilters): Promise<SearchResult> {
  const page = f.page && f.page >= 1 ? f.page : 1;
  const pageSize = f.pageSize ?? DEFAULT_PAGE_SIZE;

  // Determine whether we must filter geometry in JS (polygon or radius circle).
  const polygon = f.polygon ?? null;
  // When nothing scopes the search (no drawn area, radius, viewport bbox, or
  // city), fall back to the SE-Michigan service region so the default list is the
  // newest homes IN that region — matching the map's default frame — rather than
  // the newest scattered across the whole feed.
  const hasScope = !!polygon || !!(f.center && f.radiusMiles) || !!f.bbox || !!f.city;
  const geoBox: BBox | null = polygon
    ? boundingBox(polygon)
    : f.center && f.radiusMiles
      ? bboxFromRadius(f.center, f.radiusMiles)
      : f.bbox ?? (hasScope ? null : DEFAULT_REGION);
  const needsJsGeo = !!polygon || !!(f.center && f.radiusMiles);

  const where = buildConditions(f, geoBox);

  if (needsJsGeo) {
    // Pull a bounded candidate pool inside the bbox, then refine in JS.
    const pool = await db
      .select()
      .from(idxListings)
      .where(where)
      .orderBy(orderFor(f.sort))
      .limit(GEO_CANDIDATE_CAP);

    let filtered = pool;
    if (polygon) {
      filtered = pool.filter(
        (r) =>
          r.latitude != null &&
          r.longitude != null &&
          pointInPolygon({ lat: r.latitude, lng: r.longitude }, polygon),
      );
    } else if (f.center && f.radiusMiles) {
      const c: LatLng = f.center;
      const rad = f.radiusMiles;
      filtered = pool.filter(
        (r) =>
          r.latitude != null &&
          r.longitude != null &&
          approxMiles(c.lat, c.lng, r.latitude, r.longitude) <= rad,
      );
    }
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const rows = filtered.slice(start, start + pageSize).map(gateAddress);
    return { rows, total, page, pageSize };
  }

  // Plain DB pagination (no JS geo refinement needed).
  const [rowsRaw, countRes] = await Promise.all([
    db
      .select()
      .from(idxListings)
      .where(where)
      .orderBy(orderFor(f.sort))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: sql<number>`count(*)::int` }).from(idxListings).where(where),
  ]);
  const total = countRes[0]?.c ?? 0;
  return { rows: rowsRaw.map(gateAddress), total, page, pageSize };
}
