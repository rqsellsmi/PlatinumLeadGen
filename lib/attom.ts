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

import type { PropertyBasics, SaleHistoryEntry, ValuationResult } from './valuation';

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
  location?: { latitude?: unknown; longitude?: unknown };
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
    provider: 'attom',
  };
}
