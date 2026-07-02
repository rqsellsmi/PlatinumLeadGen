/**
 * ATTOM Data valuation client — one of the interchangeable providers behind
 * lib/valuation.ts. Selected when VALUATION_PROVIDER=attom.
 *
 * Uses a single `attomavm/detail` call, which returns the AVM (value + high/low
 * range + confidence score) alongside property characteristics and the most
 * recent sale — enough for both the pre-contact teaser and the post-contact
 * detailed report without a second billable call. (Multi-sale history would be
 * a separate saleshistory/detail call — deferred to keep cost at one call per
 * address.)
 *
 * ATTOM's JSON is loosely typed and varies by plan; every field is parsed
 * defensively and missing data degrades to null rather than throwing.
 */

import type {
  MarketTrends,
  PropertyBasics,
  SaleHistoryEntry,
  ValuationResult,
} from './valuation';
import type { HomeRecentSale } from './queries';

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

interface AttomProperty {
  identifier?: { attomId?: unknown; Id?: unknown; id?: unknown };
  area?: { geoIdV4?: unknown; geoid?: unknown };
  location?: { latitude?: unknown; longitude?: unknown; geoIdV4?: unknown; geoid?: unknown };
  summary?: { yearbuilt?: unknown; proptype?: unknown; propclass?: unknown; propsubtype?: unknown };
  building?: {
    rooms?: { beds?: unknown; bathstotal?: unknown; bathsfull?: unknown };
    size?: { livingsize?: unknown; universalsize?: unknown; bldgsize?: unknown };
  };
  lot?: { lotsize1?: unknown; lotsize2?: unknown };
  sale?: { saleTransDate?: unknown; salesearchdate?: unknown; amount?: { saleamt?: unknown } };
  avm?: {
    amount?: { value?: unknown; high?: unknown; low?: unknown; scr?: unknown };
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
 * ATTOM puts the geo ids in the `location` block. There are two systems:
 * `geoid` (readable, e.g. "…, ZI48116") which the v1 sales-trend endpoint
 * expects, and `geoIdV4` (opaque hashes) used by v4 APIs. Prefer the readable
 * `geoid` ZIP code so salestrend/snapshot works.
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
  const { address1, address2 } = splitAddress(address);
  const url = new URL(`${ATTOM_BASE}/attomavm/detail`);
  url.searchParams.set('address1', address1);
  if (address2) url.searchParams.set('address2', address2);

  const empty: ValuationResult = {
    estimatedValue: null,
    priceRangeLow: null,
    priceRangeHigh: null,
    latitude: null,
    longitude: null,
    confidenceScore: null,
    basics: null,
    saleHistory: [],
    attomId: null,
    areaGeoId: null,
    provider: 'attom',
  };

  const res = await fetch(url.toString(), {
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
  const estimatedValue = num(avm?.value);

  return {
    estimatedValue,
    priceRangeLow: num(avm?.low),
    priceRangeHigh: num(avm?.high),
    latitude: num(p.location?.latitude),
    longitude: num(p.location?.longitude),
    confidenceScore: num(avm?.scr),
    basics: parseBasics(p),
    saleHistory: parseSaleHistory(p),
    attomId: parseAttomId(p),
    areaGeoId: parseAreaGeoId(p),
    provider: 'attom',
  };
}

/**
 * Area sales trends from ATTOM's sales-trend endpoint (report "Local market"
 * section). Needs a ZIP-level geo id (captured on the AVM call). Returns null
 * on any failure so the section simply hides.
 *
 * NOTE: ATTOM's trend endpoint path/params vary by plan/version — verify these
 * against your account when you validate ATTOM on a preview deploy.
 */
export async function getAttomAreaTrends(geoIdV4: string): Promise<MarketTrends | null> {
  if (!geoIdV4) return null;
  try {
    const url = new URL(`${ATTOM_BASE}/salestrend/snapshot`);
    // ATTOM's v1 sales-trend takes `geoid` (type-prefixed code like ZI48116).
    url.searchParams.set('geoid', geoIdV4);
    url.searchParams.set('interval', 'yearly');
    const endYear = new Date().getFullYear();
    url.searchParams.set('startyear', String(endYear - 4));
    url.searchParams.set('endyear', String(endYear));
    const res = await fetch(url.toString(), {
      headers: { apikey: apiKey(), Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      salestrend?: Array<{
        daterange?: { start?: unknown; end?: unknown };
        yearlyintervalname?: unknown;
        SalesTrend?: { avgsaleprice?: unknown; medsaleprice?: unknown; homesalecount?: unknown };
        avgsaleprice?: unknown;
        medsaleprice?: unknown;
        homesalecount?: unknown;
      }>;
    };
    const trend = data.salestrend;
    if (!Array.isArray(trend) || trend.length === 0) return null;
    // Newest period is typically last; guard either way by sorting on label.
    const rows = trend.map((t) => ({
      label:
        (typeof t.yearlyintervalname === 'string' && t.yearlyintervalname) ||
        (typeof t.daterange?.end === 'string' ? t.daterange.end.slice(0, 4) : null),
      median: num(t.SalesTrend?.medsaleprice) ?? num(t.medsaleprice),
      count: num(t.SalesTrend?.homesalecount) ?? num(t.homesalecount),
    }));
    const latest = rows[rows.length - 1];
    const prior = rows.length > 1 ? rows[rows.length - 2] : null;
    const yoy =
      latest.median != null && prior?.median != null && prior.median > 0
        ? Math.round(((latest.median - prior.median) / prior.median) * 1000) / 10
        : null;
    if (latest.median == null && latest.count == null) return null;
    return {
      medianSalePrice: latest.median,
      yoyChangePct: yoy,
      homeSales: latest.count,
      periodLabel: latest.label,
    };
  } catch (err) {
    console.error('[attom] getAttomAreaTrends failed:', err);
    return null;
  }
}

/**
 * Admin diagnostic — hit the live ATTOM AVM endpoint for an address and report
 * exactly what came back (raw keys, identifier, area, avm) plus what our
 * normalized result + trends/comps resolve to. Lets us see why an enrichment
 * isn't populating (e.g. the AVM response has no `area.geoIdV4`).
 */
export async function probeAttom(address: string): Promise<{
  status: number | null;
  error: string | null;
  rawKeys: string[];
  identifier: unknown;
  area: unknown;
  location: unknown;
  avm: unknown;
  normalized: ValuationResult | null;
  trends: MarketTrends | null;
  compsCount: number;
}> {
  const base = {
    status: null as number | null,
    error: null as string | null,
    rawKeys: [] as string[],
    identifier: null as unknown,
    area: null as unknown,
    location: null as unknown,
    avm: null as unknown,
    normalized: null as ValuationResult | null,
    trends: null as MarketTrends | null,
    compsCount: 0,
  };
  try {
    const { address1, address2 } = splitAddress(address);
    const url = new URL(`${ATTOM_BASE}/attomavm/detail`);
    url.searchParams.set('address1', address1);
    if (address2) url.searchParams.set('address2', address2);
    const res = await fetch(url.toString(), {
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
      base.area = p.area ?? null;
      base.location = p.location ?? null;
      base.avm = p.avm ?? null;
    }
    base.normalized = await getAttomValuation(address).catch(() => null);
    if (base.normalized?.areaGeoId) {
      base.trends = await getAttomAreaTrends(base.normalized.areaGeoId).catch(() => null);
    }
    if (base.normalized?.attomId) {
      base.compsCount = (await getAttomComps(base.normalized.attomId, 6).catch(() => [])).length;
    }
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'probe error';
    return base;
  }
}

/**
 * Sales comparables for a subject property (by ATTOM id). Used only as a
 * fallback when there are no RE/MAX Platinum closings for the area. Mapped into
 * the HomeRecentSale shape so the existing comps grid renders them. Returns []
 * on any failure.
 *
 * NOTE: ATTOM's salescomparables path/version varies by plan — verify on your
 * account. Comps have no photo, so photoUrl is null.
 */
export async function getAttomComps(attomId: string, limit = 6): Promise<HomeRecentSale[]> {
  if (!attomId) return [];
  try {
    const url = new URL(`${ATTOM_BASE}/salescomparables/propid/${encodeURIComponent(attomId)}`);
    url.searchParams.set('maxComps', String(limit));
    const res = await fetch(url.toString(), {
      headers: { apikey: apiKey(), Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      RESPONSE_GROUP?: {
        RESPONSE?: {
          RESPONSE_DATA?: {
            PROPERTY_INFORMATION_RESPONSE_ext?: {
              SUBJECT_PROPERTY_ext?: unknown;
              COMPARABLE_PROPERTY_ext?: unknown[];
            };
          };
        };
      };
      // Some plans return a flatter shape:
      comparables?: Array<Record<string, unknown>>;
      property?: AttomProperty[];
    };

    // Prefer the flat shape when present.
    const flat = Array.isArray(data.comparables)
      ? data.comparables
      : Array.isArray(data.property)
        ? data.property
        : [];

    const out: HomeRecentSale[] = [];
    flat.slice(0, limit).forEach((c, i) => {
      const rec = c as {
        address?: { line1?: unknown; oneLine?: unknown };
        sale?: { amount?: { saleamt?: unknown }; saleTransDate?: unknown };
        location?: { latitude?: unknown };
        saleamt?: unknown;
        saleAmount?: unknown;
        salePrice?: unknown;
        address1?: unknown;
      };
      const price =
        num(rec.sale?.amount?.saleamt) ??
        num(rec.saleamt) ??
        num(rec.saleAmount) ??
        num(rec.salePrice);
      const addr =
        (typeof rec.address?.oneLine === 'string' && rec.address.oneLine) ||
        (typeof rec.address?.line1 === 'string' && rec.address.line1) ||
        (typeof rec.address1 === 'string' && rec.address1) ||
        'Comparable sale';
      const rawDate = rec.sale?.saleTransDate;
      const close = typeof rawDate === 'string' && rawDate ? new Date(rawDate.slice(0, 10)) : null;
      if (price == null) return;
      out.push({
        id: -1 - i, // negative synthetic ids — never collide with DB rows
        address: addr,
        soldPrice: price,
        daysOnMarket: null,
        closeDate: close && !Number.isNaN(close.getTime()) ? close : null,
        photoUrl: null,
        cityName: null,
      });
    });
    return out;
  } catch (err) {
    console.error('[attom] getAttomComps failed:', err);
    return [];
  }
}
