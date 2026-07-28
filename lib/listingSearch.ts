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

/**
 * The Southeast-Michigan service region — the default map frame AND the default
 * search bounds when nothing else scopes the query, so the unfiltered /homes list
 * is the newest homes IN this region (not the newest scattered statewide). Covers
 * the brokerage's core: Ann Arbor/Brighton/Howell/Fenton/Flint/Pontiac area.
 */
export const DEFAULT_REGION: BBox = { minLat: 42.2, minLng: -84.2, maxLat: 43.3, maxLng: -83.0 };

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

/**
 * Centroid of a saved search's geography, used as the routing anchor for the
 * buyer's FIRST saved search (proximity → lead assignment, Phase 4). Prefers an
 * explicit radius center, then the polygon centroid, then the bbox center.
 * Returns null when the search has no geography (city-name-only or unfiltered).
 */
export function centroidOfFilters(f: SearchFilters): LatLng | null {
  if (f.center && Number.isFinite(f.center.lat) && Number.isFinite(f.center.lng)) {
    return { lat: f.center.lat, lng: f.center.lng };
  }
  if (f.polygon && f.polygon.length >= 3) {
    let sumLat = 0;
    let sumLng = 0;
    for (const p of f.polygon) {
      sumLat += p.lat;
      sumLng += p.lng;
    }
    return { lat: sumLat / f.polygon.length, lng: sumLng / f.polygon.length };
  }
  if (f.bbox) {
    return {
      lat: (f.bbox.minLat + f.bbox.maxLat) / 2,
      lng: (f.bbox.minLng + f.bbox.maxLng) / 2,
    };
  }
  return null;
}

const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    : `$${Math.round(n / 1000)}K`;

/**
 * A short human label for a saved search, e.g. "Homes in Clarkston · 3+ bd ·
 * $200K–$400K". Pure so it round-trips the same on server and client and is
 * unit-tested directly. Falls back to "All homes" when nothing is set.
 */
export function describeSearch(f: SearchFilters): string {
  const parts: string[] = [];

  if (f.city) parts.push(`Homes in ${f.city}`);
  else if (f.polygon && f.polygon.length >= 3) parts.push('Homes in a drawn area');
  else if (f.center) parts.push('Homes near a point');
  else if (f.bbox) parts.push('Homes in the map area');
  else parts.push('Homes');

  const types = f.propertyTypes?.filter(Boolean);
  if (types && types.length) parts.push(types.length <= 2 ? types.join(' / ') : `${types.length} types`);

  if (f.bedsMin) parts.push(`${f.bedsMin}+ bd`);
  if (f.bathsMin) parts.push(`${f.bathsMin}+ ba`);

  if (f.priceMin != null && f.priceMax != null) parts.push(`${money(f.priceMin)}–${money(f.priceMax)}`);
  else if (f.priceMin != null) parts.push(`${money(f.priceMin)}+`);
  else if (f.priceMax != null) parts.push(`up to ${money(f.priceMax)}`);

  if (f.waterfront) parts.push('waterfront');
  if (f.pool) parts.push('pool');
  if (f.newConstruction) parts.push('new construction');

  return parts.join(' · ');
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

/** Decode a viewport bbox from a `bbox` param: "minLat,minLng,maxLat,maxLng". */
export function parseBBox(v: string | undefined): BBox | undefined {
  if (!v) return undefined;
  const p = v.split(',').map((s) => parseFloat(s));
  if (p.length !== 4 || !p.every((n) => Number.isFinite(n))) return undefined;
  const [minLat, minLng, maxLat, maxLng] = p;
  if (minLat > maxLat || minLng > maxLng) return undefined;
  return { minLat, minLng, maxLat, maxLng };
}

/** Encode a bbox back to the `bbox` param form (round-trips with parseBBox). */
export function encodeBBox(b: BBox): string {
  return [b.minLat, b.minLng, b.maxLat, b.maxLng].map((n) => n.toFixed(5)).join(',');
}

/**
 * SearchFilters → a `/homes` querystring (the reverse of normalizeFilters for
 * the fields a saved search carries). Used to turn a saved search back into a
 * live results link. Round-trips through normalizeFilters for the common cases.
 */
export function filtersToQuery(f: SearchFilters): string {
  const sp = new URLSearchParams();
  const set = (k: string, v: number | string | undefined | null) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  };
  set('priceMin', f.priceMin);
  set('priceMax', f.priceMax);
  set('bedsMin', f.bedsMin);
  set('bathsMin', f.bathsMin);
  set('city', f.city);
  set('sqftMin', f.sqftMin);
  set('sqftMax', f.sqftMax);
  set('yearMin', f.yearMin);
  set('yearMax', f.yearMax);
  if (f.propertyTypes && f.propertyTypes.length) sp.set('type', f.propertyTypes.join(','));
  set('lotAcresMin', f.lotAcresMin);
  set('garageMin', f.garageMin);
  if (f.waterfront) sp.set('waterfront', '1');
  if (f.pool) sp.set('pool', '1');
  if (f.newConstruction) sp.set('newConstruction', '1');
  if (f.basementFinished) sp.set('basementFinished', '1');
  if (f.fireplace) sp.set('fireplace', '1');
  set('hoaMax', f.hoaMax);
  set('domMax', f.domMax);
  if (f.polygon && f.polygon.length >= 3) sp.set('poly', encodePolygon(f.polygon));
  if (f.center) {
    set('lat', f.center.lat);
    set('lng', f.center.lng);
    set('radius', f.radiusMiles);
  }
  if (f.bbox) sp.set('bbox', encodeBBox(f.bbox));
  set('sort', f.sort);
  return sp.toString();
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
  const bbox = parseBBox(first(params.bbox));
  if (bbox) f.bbox = bbox;

  const sort = first(params.sort) as SearchSort | undefined;
  if (sort && SORTS.includes(sort)) f.sort = sort;

  const page = num(first(params.page));
  f.page = page && page >= 1 ? Math.floor(page) : 1;
  const pageSize = num(first(params.pageSize));
  f.pageSize = pageSize ? Math.min(Math.max(Math.floor(pageSize), 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return f;
}
