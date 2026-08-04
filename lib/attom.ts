/**
 * ATTOM Data valuation client — one of the interchangeable providers behind
 * lib/valuation.ts. Selected when VALUATION_PROVIDER=attom.
 *
 * ONE endpoint, deliberately: `attomavm/detail`. It returns the AVM (value +
 * high/low range + confidence score) alongside the property characteristics and
 * the most recent sale, which is everything the report shows. Sales Trend,
 * Sales Comparables and Expanded Profile are separate billable ATTOM products
 * and are not called — if you add one, add it here and nowhere else, so the
 * per-lead cost of a valuation stays exactly one call.
 *
 * Results are cached for 30 days by normalized address (lib/valuationCache), so
 * a repeat visit to the same address doesn't re-bill.
 *
 * ATTOM's JSON is loosely typed and varies by plan; every field is parsed
 * defensively and missing data degrades to null rather than throwing.
 */

import type {
  PropertyBasics,
  PropertyRecord,
  SaleHistoryEntry,
  ValuationResult,
} from './valuation';

const ATTOM_BASE = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0';

function apiKey(): string {
  const k = process.env.ATTOM_API_KEY;
  if (!k) throw new Error('ATTOM_API_KEY is not set');
  return k;
}

/** Coerce ATTOM's mixed string/number fields to a finite number or null. */
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce to a trimmed non-empty string or null. */
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'null' ? null : s;
}

/**
 * ATTOM wants the address as address1 (street) + address2 (city, state ZIP).
 * Google Places gives us "123 Main St, Brighton, MI 48116" — split on the
 * first comma into street vs. the rest.
 */
function splitAddress(address: string): { address1: string; address2: string } {
  const idx = address.indexOf(',');
  if (idx === -1) return { address1: address.trim(), address2: '' };
  return {
    address1: address.slice(0, idx).trim(),
    address2: address.slice(idx + 1).trim(),
  };
}

/** Build the AVM request URL (single source of truth — used live and by the probe). */
function avmUrl(address: string): string {
  const { address1, address2 } = splitAddress(address);
  const url = new URL(`${ATTOM_BASE}/attomavm/detail`);
  url.searchParams.set('address1', address1);
  if (address2) url.searchParams.set('address2', address2);
  return url.toString();
}

/**
 * The AVM detail response shape, as far as we read it. Sections vary by plan,
 * so everything is optional and every leaf is `unknown` — see num()/str().
 */
interface AttomProperty {
  identifier?: { attomId?: unknown; Id?: unknown; id?: unknown; apn?: unknown };
  area?: { geoIdV4?: unknown; geoid?: unknown; subdname?: unknown; munname?: unknown };
  address?: { oneLine?: unknown; countrySubd?: unknown };
  location?: { latitude?: unknown; longitude?: unknown; geoIdV4?: unknown; geoid?: unknown };
  summary?: {
    yearbuilt?: unknown;
    proptype?: unknown;
    propclass?: unknown;
    propsubtype?: unknown;
    propLandUse?: unknown;
    levels?: unknown;
    unitsCount?: unknown;
  };
  building?: {
    rooms?: {
      beds?: unknown;
      bathstotal?: unknown;
      bathsfull?: unknown;
      bathshalf?: unknown;
      roomsTotal?: unknown;
      roomstotal?: unknown;
    };
    size?: { livingsize?: unknown; universalsize?: unknown; bldgsize?: unknown };
    construction?: {
      wallType?: unknown;
      frameType?: unknown;
      roofcover?: unknown;
      roofShape?: unknown;
      condition?: unknown;
      constructiontype?: unknown;
    };
    interior?: { fplccount?: unknown; bsmtsize?: unknown };
    parking?: { prkgType?: unknown; garagetype?: unknown; prkgSpaces?: unknown };
    summary?: { levels?: unknown; storyDesc?: unknown; unitsCount?: unknown };
  };
  lot?: { lotsize1?: unknown; lotsize2?: unknown; pooltype?: unknown; zoningType?: unknown; zoning?: unknown };
  utilities?: { heatingtype?: unknown; coolingtype?: unknown };
  sale?: { saleTransDate?: unknown; salesearchdate?: unknown; amount?: { saleamt?: unknown } };
  avm?: {
    amount?: { value?: unknown; high?: unknown; low?: unknown; scr?: unknown };
    eventDate?: unknown;
  };
}

function parseBasics(p: AttomProperty): PropertyBasics {
  const beds = num(p.building?.rooms?.beds);
  const baths = num(p.building?.rooms?.bathstotal) ?? num(p.building?.rooms?.bathsfull);
  const sqft =
    num(p.building?.size?.livingsize) ??
    num(p.building?.size?.universalsize) ??
    num(p.building?.size?.bldgsize);
  // lotsize2 is square feet; lotsize1 is acres — convert acres if only that's present.
  const lotSf = num(p.lot?.lotsize2);
  const lotAcres = num(p.lot?.lotsize1);
  const lotSizeSqft = lotSf ?? (lotAcres != null ? Math.round(lotAcres * 43560) : null);
  const propertyType =
    (typeof p.summary?.propsubtype === 'string' && p.summary.propsubtype) ||
    (typeof p.summary?.proptype === 'string' && p.summary.proptype) ||
    (typeof p.summary?.propclass === 'string' && p.summary.propclass) ||
    null;
  return { beds, baths, sqft, yearBuilt: num(p.summary?.yearbuilt), lotSizeSqft, propertyType };
}

/**
 * Everything else the AVM response carries about the home, in the shared
 * PropertyRecord shape so the report can reuse components/PropertyDetails.
 *
 * The AVM endpoint returns no owner and no assessment block, so those fields are
 * fixed at null here — that is a property of the endpoint, not missing data.
 */
function parseDetail(p: AttomProperty): PropertyRecord {
  const b = parseBasics(p);
  const rooms = p.building?.rooms;
  const construction = p.building?.construction;
  const parking = p.building?.parking;
  const bSummary = p.building?.summary;
  const lotAcres = num(p.lot?.lotsize1);

  // Provider-specific long tail — anything without a first-class field.
  const extra: { label: string; value: string }[] = [];
  const addExtra = (label: string, v: unknown) => {
    const s = str(v);
    if (s) extra.push({ label, value: s });
  };
  addExtra('Fireplaces', p.building?.interior?.fplccount);
  addExtra('Basement', p.building?.interior?.bsmtsize);
  addExtra('Frame', construction?.frameType);
  addExtra('Valuation date', typeof p.avm?.eventDate === 'string' ? p.avm.eventDate.slice(0, 10) : null);

  return {
    provider: 'attom',
    formattedAddress: str(p.address?.oneLine),
    latitude: num(p.location?.latitude),
    longitude: num(p.location?.longitude),
    propertyType: b.propertyType,
    propertyUse: str(p.summary?.propLandUse) ?? str(p.summary?.propclass),
    yearBuilt: b.yearBuilt,
    beds: b.beds,
    bathsFull: num(rooms?.bathsfull),
    bathsHalf: num(rooms?.bathshalf),
    bathsTotal: num(rooms?.bathstotal),
    sqft: b.sqft,
    lotSizeSqft: b.lotSizeSqft,
    lotSizeAcres: lotAcres,
    stories: num(bSummary?.levels) ?? num(p.summary?.levels) ?? num(bSummary?.storyDesc),
    rooms: num(rooms?.roomsTotal) ?? num(rooms?.roomstotal),
    units: num(bSummary?.unitsCount) ?? num(p.summary?.unitsCount),
    garageType: str(parking?.prkgType) ?? str(parking?.garagetype),
    garageSpaces: num(parking?.prkgSpaces),
    pool: str(p.lot?.pooltype) ? true : null,
    heating: str(p.utilities?.heatingtype),
    cooling: str(p.utilities?.coolingtype),
    construction: str(construction?.wallType) ?? str(construction?.constructiontype),
    roof: str(construction?.roofcover) ?? str(construction?.roofShape),
    condition: str(construction?.condition),
    county: str(p.area?.munname) ?? str(p.address?.countrySubd),
    subdivision: str(p.area?.subdname),
    zoning: str(p.lot?.zoningType) ?? str(p.lot?.zoning),
    apn: str(p.identifier?.apn),
    lastSaleDate: (() => {
      const d = str(p.sale?.saleTransDate) ?? str(p.sale?.salesearchdate);
      return d ? d.slice(0, 10) : null;
    })(),
    lastSalePrice: num(p.sale?.amount?.saleamt),
    // Not returned by the AVM endpoint — see the doc comment above.
    assessedValue: null,
    marketValue: null,
    assessedLand: null,
    assessedImprovements: null,
    taxAmount: null,
    taxYear: null,
    owner: null,
    attomId: parseAttomId(p),
    extra,
  };
}

function parseAttomId(p: AttomProperty): string | null {
  const raw = p.identifier?.attomId ?? p.identifier?.Id ?? p.identifier?.id;
  return raw == null ? null : String(raw);
}

/**
 * Pick a geo code from an ATTOM geoIdV4/geoid value. It can be a delimited
 * string of type-prefixed codes (e.g. "CO26093, ZI48116, PL...") or an object
 * keyed by type. Prefer ZIP ("ZI"), then county ("CO") for a broader area.
 */
function pickGeoCode(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const chosen = obj.ZI ?? obj.zip ?? obj.CO ?? obj.county ?? Object.values(obj)[0];
    return chosen == null ? null : String(chosen);
  }
  const codes = String(raw)
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (!codes.length) return null;
  return (
    codes.find((c) => c.toUpperCase().startsWith('ZI')) ??
    codes.find((c) => c.toUpperCase().startsWith('CO')) ??
    codes[0]
  );
}

/**
 * The ZIP-level geo id the AVM response carries. Stored alongside attomId as
 * the property's area key; no endpoint is called with it today.
 */
function parseAreaGeoId(p: AttomProperty): string | null {
  return (
    pickGeoCode(p.location?.geoid) ??
    pickGeoCode(p.area?.geoid) ??
    pickGeoCode(p.location?.geoIdV4) ??
    pickGeoCode(p.area?.geoIdV4)
  );
}

function parseSaleHistory(p: AttomProperty): SaleHistoryEntry[] {
  const price = num(p.sale?.amount?.saleamt);
  const rawDate = p.sale?.saleTransDate ?? p.sale?.salesearchdate;
  const date = typeof rawDate === 'string' && rawDate ? rawDate.slice(0, 10) : null;
  if (price == null && date == null) return [];
  return [{ date, price }];
}

/**
 * Call ATTOM's AVM detail endpoint. Returns nulls (not an error) when ATTOM has
 * no match for the address, so lib/valuation can fall back to RentCast.
 */
export async function getAttomValuation(address: string): Promise<ValuationResult> {
  const empty: ValuationResult = {
    estimatedValue: null,
    priceRangeLow: null,
    priceRangeHigh: null,
    latitude: null,
    longitude: null,
    confidenceScore: null,
    basics: null,
    detail: null,
    saleHistory: [],
    attomId: null,
    areaGeoId: null,
    provider: 'attom',
  };

  const res = await fetch(avmUrl(address), {
    headers: { apikey: apiKey(), Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    // ATTOM returns 400/404 with a status code when it can't match an address.
    if (res.status === 400 || res.status === 404) return empty;
    throw new Error(`ATTOM error ${res.status}`);
  }

  const data = (await res.json()) as {
    status?: { code?: number; total?: number };
    property?: AttomProperty[];
  };

  const p = data.property?.[0];
  if (!p) return empty;

  const avm = p.avm?.amount;

  return {
    estimatedValue: num(avm?.value),
    priceRangeLow: num(avm?.low),
    priceRangeHigh: num(avm?.high),
    latitude: num(p.location?.latitude),
    longitude: num(p.location?.longitude),
    confidenceScore: num(avm?.scr),
    basics: parseBasics(p),
    detail: parseDetail(p),
    saleHistory: parseSaleHistory(p),
    attomId: parseAttomId(p),
    areaGeoId: parseAreaGeoId(p),
    provider: 'attom',
  };
}

/**
 * Admin diagnostic — hit the live ATTOM AVM endpoint for an address and report
 * exactly what came back (raw section keys, identifier, location, avm) plus what
 * our normalized result resolves to. Lets us see why a report isn't populating
 * without guessing at the provider's response shape.
 */
export async function probeAttom(address: string): Promise<{
  url: string;
  status: number | null;
  error: string | null;
  rawKeys: string[];
  identifier: unknown;
  location: unknown;
  avm: unknown;
  normalized: ValuationResult | null;
}> {
  const url = avmUrl(address);
  const base = {
    url,
    status: null as number | null,
    error: null as string | null,
    rawKeys: [] as string[],
    identifier: null as unknown,
    location: null as unknown,
    avm: null as unknown,
    normalized: null as ValuationResult | null,
  };
  try {
    const res = await fetch(url, {
      headers: { apikey: apiKey(), Accept: 'application/json' },
      cache: 'no-store',
    });
    base.status = res.status;
    if (!res.ok) {
      base.error = `HTTP ${res.status}`;
      return base;
    }
    const data = (await res.json()) as { property?: AttomProperty[] };
    const p = data.property?.[0];
    if (p) {
      base.rawKeys = Object.keys(p);
      base.identifier = p.identifier ?? null;
      base.location = p.location ?? null;
      base.avm = p.avm ?? null;
      // Parse the response we already have — no second billable call.
      base.normalized = {
        estimatedValue: num(p.avm?.amount?.value),
        priceRangeLow: num(p.avm?.amount?.low),
        priceRangeHigh: num(p.avm?.amount?.high),
        latitude: num(p.location?.latitude),
        longitude: num(p.location?.longitude),
        confidenceScore: num(p.avm?.amount?.scr),
        basics: parseBasics(p),
        detail: parseDetail(p),
        saleHistory: parseSaleHistory(p),
        attomId: parseAttomId(p),
        areaGeoId: parseAreaGeoId(p),
        provider: 'attom',
      };
    }
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'probe error';
    return base;
  }
}
