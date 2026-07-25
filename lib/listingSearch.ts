/**
 * Client-safe pure helpers + types for buyer home search. NO server imports (no
 * `db`, no drizzle) so this module can be pulled into client components (the map,
 * the listing card) and unit-tested directly. The server query that consumes
 * these lives in `lib/idxSearch.ts`.
 */

export type SearchSort = 'price_asc' | 'price_desc' | 'newest' | 'dom';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface SearchFilters {
  priceMin?: number;
  priceMax?: number;
  bedsMin?: number;
  bathsMin?: number;
  city?: string;
  sqftMin?: number;
  sqftMax?: number;
  yearMin?: number;
  yearMax?: number;
  propertyTypes?: string[];
  lotAcresMin?: number;
  garageMin?: number;
  waterfront?: boolean;
  pool?: boolean;
  newConstruction?: boolean;
  hoaMax?: number;
  domMax?: number;
  basementFinished?: boolean;
  fireplace?: boolean;
  /** Draw-an-area polygon (ring of vertices). */
  polygon?: LatLng[];
  /** Rectangle/viewport bounds. */
  bbox?: BBox;
  /** Radius search from a point (miles). */
  center?: LatLng;
  radiusMiles?: number;
  sort?: SearchSort;
  page?: number;
  pageSize?: number;
}

/** The "for sale" statuses a buyer search shows (O2: Active + AUC only). */
export const FOR_SALE_STATUSES = ['Active', 'ActiveUnderContract'] as const;

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 60;

/** Ray-casting point-in-polygon. `ring` is a list of vertices (auto-closed). */
export function pointInPolygon(pt: LatLng, ring: LatLng[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Axis-aligned bounding box of a polygon (null if degenerate). */
export function boundingBox(ring: LatLng[]): BBox | null {
  if (ring.length < 3) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** BBox around a center point + radius (miles). ~69 mi per degree latitude. */
export function bboxFromRadius(center: LatLng, radiusMiles: number): BBox {
  const dLat = radiusMiles / 69;
  const cos = Math.cos((center.lat * Math.PI) / 180) || 1e-6;
  const dLng = radiusMiles / (69 * Math.abs(cos));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

/** Equirectangular miles between two points (matches lib/idx approxMiles). */
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 69;
  const dLng = (bLng - aLng) * 69 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * The human status label for a for-sale card/pin (O2: AUC must show its real
 * status, never a generic "For Sale"). Prefers the raw Realcomp `mlsStatus` for
 * Active-Under-Contract (e.g. "Accepting Backup Offers").
 */
export function listingStatusLabel(listing: {
  standardStatus?: string | null;
  mlsStatus?: string | null;
}): string {
  const std = listing.standardStatus ?? '';
  const mls = (listing.mlsStatus ?? '').trim();
  switch (std) {
    case 'Active':
      return 'For Sale';
    case 'ActiveUnderContract':
      return mls || 'Under Contract';
    case 'Pending':
      return mls || 'Pending';
    case 'Closed':
      return 'Sold';
    default:
      return mls || std || 'For Sale';
  }
}

/** True when the listing is under contract / pending (badge should read alert). */
export function isUnderContractLike(standardStatus?: string | null): boolean {
  return standardStatus === 'ActiveUnderContract' || standardStatus === 'Pending';
}

/**
 * Compliance: a listing whose address is hidden (internetAddressDisplayYN=false)
 * must not have its exact location revealed. When `hidden`, round the pin to ~2
 * decimals (≈1 km) so the map shows the general area, not the doorstep.
 */
export function coarsenPin(lat: number, lng: number, hidden: boolean): LatLng {
  if (!hidden) return { lat, lng };
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

export interface CityActiveStat {
  city: string;
  count: number;
  lat: number | null;
  lng: number | null;
}

export interface OfficePoint {
  lat: number | null;
  lng: number | null;
}

/**
 * Select the buyer-homepage city tiles: exclude the admin exclusion list
 * (tiles-only), keep cities within `radiusMiles` of an office (when office
 * coordinates exist), rank by active-listing count desc, take `limit`. Pure so
 * the selection logic is unit-tested independently of the DB.
 */
export function rankBuyerCityTiles(
  stats: CityActiveStat[],
  offices: OfficePoint[],
  excluded: string[],
  limit: number,
  radiusMiles = 20,
): CityActiveStat[] {
  const excludedSet = new Set(excluded.map((c) => c.trim().toLowerCase()).filter(Boolean));
  const officePts = offices.filter((o) => o.lat != null && o.lng != null) as {
    lat: number;
    lng: number;
  }[];

  let filtered = stats.filter((s) => s.city && !excludedSet.has(s.city.toLowerCase()));
  if (officePts.length) {
    filtered = filtered.filter(
      (s) =>
        s.lat != null &&
        s.lng != null &&
        officePts.some((o) => milesBetween(o.lat, o.lng, s.lat as number, s.lng as number) <= radiusMiles),
    );
  }
  return filtered.sort((a, b) => b.count - a.count).slice(0, limit);
}

/** Parse a comma/newline-separated excluded-cities setting into a clean list. */
export function parseExcludedCities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function boolFlag(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  const s = String(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return undefined;
}

const SORTS: SearchSort[] = ['price_asc', 'price_desc', 'newest', 'dom'];

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Decode a polygon from a `poly` param: "lat,lng;lat,lng;...". */
export function parsePolygon(v: string | undefined): LatLng[] | undefined {
  if (!v) return undefined;
  const pts = v
    .split(';')
    .map((pair) => pair.split(','))
    .filter((xy) => xy.length === 2)
    .map(([la, ln]) => ({ lat: parseFloat(la), lng: parseFloat(ln) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return pts.length >= 3 ? pts : undefined;
}

/** Encode a polygon back to the `poly` param form (round-trips with parsePolygon). */
export function encodePolygon(ring: LatLng[]): string {
  return ring.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';');
}

/** Querystring → typed, clamped SearchFilters. Whitelists sort; drops garbage. */
export function normalizeFilters(params: RawParams): SearchFilters {
  const f: SearchFilters = {};
  f.priceMin = num(first(params.priceMin));
  f.priceMax = num(first(params.priceMax));
  f.bedsMin = num(first(params.bedsMin));
  f.bathsMin = num(first(params.bathsMin));
  const city = first(params.city);
  if (city && city.trim()) f.city = city.trim();
  f.sqftMin = num(first(params.sqftMin));
  f.sqftMax = num(first(params.sqftMax));
  f.yearMin = num(first(params.yearMin));
  f.yearMax = num(first(params.yearMax));
  const types = params.propertyTypes ?? params.type;
  if (types) {
    const list = (Array.isArray(types) ? types : String(types).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) f.propertyTypes = list;
  }
  f.lotAcresMin = num(first(params.lotAcresMin));
  f.garageMin = num(first(params.garageMin));
  f.waterfront = boolFlag(first(params.waterfront));
  f.pool = boolFlag(first(params.pool));
  f.newConstruction = boolFlag(first(params.newConstruction));
  f.hoaMax = num(first(params.hoaMax));
  f.domMax = num(first(params.domMax));
  f.basementFinished = boolFlag(first(params.basementFinished));
  f.fireplace = boolFlag(first(params.fireplace));

  const poly = parsePolygon(first(params.poly));
  if (poly) f.polygon = poly;
  const lat = num(first(params.lat));
  const lng = num(first(params.lng));
  if (lat != null && lng != null) {
    f.center = { lat, lng };
    f.radiusMiles = num(first(params.radius)) ?? 15;
  }

  const sort = first(params.sort) as SearchSort | undefined;
  if (sort && SORTS.includes(sort)) f.sort = sort;

  const page = num(first(params.page));
  f.page = page && page >= 1 ? Math.floor(page) : 1;
  const pageSize = num(first(params.pageSize));
  f.pageSize = pageSize ? Math.min(Math.max(Math.floor(pageSize), 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return f;
}
