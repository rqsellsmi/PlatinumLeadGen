/**
 * RentCast AVM client (Section 1.2 / 4.7).
 * One of the interchangeable valuation providers behind lib/valuation.ts.
 * Returns the shared ValuationResult shape; RentCast has no property-detail
 * data, so `basics`, `confidenceScore`, and `saleHistory` come back empty.
 */

import type { PropertyRecord, ValuationResult } from './valuation';

const RENTCAST_BASE = 'https://api.rentcast.io/v1';

function rcNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function rcStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function apiKey(): string {
  const k = process.env.RENTCAST_API_KEY;
  if (!k) throw new Error('RENTCAST_API_KEY is not set');
  return k;
}

/**
 * Call the RentCast AVM value endpoint for an address.
 * Returns nulls (not an error) when RentCast has no data for the address.
 */
export async function getRentcastValuation(address: string): Promise<ValuationResult> {
  const url = new URL(`${RENTCAST_BASE}/avm/value`);
  url.searchParams.set('address', address);

  const res = await fetch(url.toString(), {
    headers: { 'X-Api-Key': apiKey(), Accept: 'application/json' },
    // RentCast data is not user-specific; allow brief caching at the platform edge.
    cache: 'no-store',
  });

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
    provider: 'rentcast',
  };

  if (!res.ok) {
    if (res.status === 404) return empty;
    throw new Error(`RentCast error ${res.status}`);
  }

  const data = (await res.json()) as {
    price?: number;
    priceRangeLow?: number;
    priceRangeHigh?: number;
    latitude?: number;
    longitude?: number;
  };

  return {
    ...empty,
    estimatedValue: data.price ?? null,
    priceRangeLow: data.priceRangeLow ?? (data.price ? Math.round(data.price * 0.92) : null),
    priceRangeHigh: data.priceRangeHigh ?? (data.price ? Math.round(data.price * 1.08) : null),
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
  };
}

/**
 * Full property record from RentCast's `/properties` endpoint (owner, features,
 * tax/assessment, last sale). Secondary to ATTOM. Returns null when RentCast has
 * no record or the plan doesn't include property records. Defensive parsing.
 */
export async function getRentcastPropertyRecord(
  address: string,
): Promise<{ raw: unknown; record: PropertyRecord } | null> {
  const url = new URL(`${RENTCAST_BASE}/properties`);
  url.searchParams.set('address', address);
  const res = await fetch(url.toString(), {
    headers: { 'X-Api-Key': apiKey(), Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`RentCast error ${res.status}`);
  }
  const arr = (await res.json()) as Array<Record<string, unknown>>;
  const p = Array.isArray(arr) ? arr[0] : null;
  if (!p) return null;

  const features = (p.features as Record<string, unknown>) ?? {};
  const ownerRaw = p.owner as Record<string, unknown> | undefined;
  const mailingAddr = ownerRaw?.mailingAddress as Record<string, unknown> | undefined;
  const names = Array.isArray(ownerRaw?.names)
    ? (ownerRaw!.names as unknown[]).map((n) => String(n)).filter(Boolean)
    : [];

  // Latest tax assessment / property tax by year key.
  const latestByYear = (obj: unknown): Record<string, unknown> | null => {
    if (!obj || typeof obj !== 'object') return null;
    const years = Object.keys(obj as Record<string, unknown>).sort();
    const k = years[years.length - 1];
    return k ? ((obj as Record<string, unknown>)[k] as Record<string, unknown>) : null;
  };
  const assess = latestByYear(p.taxAssessments);
  const propTax = latestByYear(p.propertyTaxes);

  const extra: { label: string; value: string }[] = [];
  const addExtra = (label: string, v: unknown) => {
    const s = rcStr(v);
    if (s) extra.push({ label, value: s });
  };
  addExtra('Architecture', features.architectureType);
  addExtra('Exterior', features.exteriorType);
  addExtra('Foundation', features.foundationType);
  addExtra('Floors', features.floorCount);
  addExtra('Zoning', p.zoning);
  addExtra('Subdivision', p.subdivision);

  const owner =
    names.length || mailingAddr || p.ownerOccupied != null
      ? {
          names,
          ownerOccupied: typeof p.ownerOccupied === 'boolean' ? p.ownerOccupied : null,
          mailingAddress: rcStr(mailingAddr?.formattedAddress),
        }
      : null;

  const record: PropertyRecord = {
    provider: 'rentcast',
    formattedAddress: rcStr(p.formattedAddress),
    latitude: rcNum(p.latitude),
    longitude: rcNum(p.longitude),
    propertyType: rcStr(p.propertyType),
    propertyUse: rcStr(p.propertyType),
    yearBuilt: rcNum(p.yearBuilt),
    beds: rcNum(p.bedrooms),
    bathsFull: null,
    bathsHalf: null,
    bathsTotal: rcNum(p.bathrooms),
    sqft: rcNum(p.squareFootage),
    lotSizeSqft: rcNum(p.lotSize),
    lotSizeAcres: rcNum(p.lotSize) != null ? Math.round((rcNum(p.lotSize)! / 43560) * 100) / 100 : null,
    stories: rcNum(features.floorCount),
    rooms: rcNum(features.roomCount),
    units: rcNum(features.unitCount),
    garageType: features.garage ? rcStr(features.garageType) ?? 'Garage' : null,
    garageSpaces: rcNum(features.garageSpaces),
    pool: typeof features.pool === 'boolean' ? (features.pool as boolean) : null,
    heating: features.heating ? rcStr(features.heatingType) ?? 'Yes' : null,
    cooling: features.cooling ? rcStr(features.coolingType) ?? 'Yes' : null,
    construction: rcStr(features.exteriorType),
    roof: rcStr(features.roofType),
    condition: null,
    county: rcStr(p.county),
    subdivision: rcStr(p.subdivision),
    zoning: rcStr(p.zoning),
    apn: rcStr(p.assessorID),
    lastSaleDate: (() => {
      const d = rcStr(p.lastSaleDate);
      return d ? d.slice(0, 10) : null;
    })(),
    lastSalePrice: rcNum(p.lastSalePrice),
    assessedValue: rcNum(assess?.value),
    marketValue: null,
    assessedLand: rcNum(assess?.land),
    assessedImprovements: rcNum(assess?.improvements),
    taxAmount: rcNum(propTax?.total),
    taxYear: rcNum(propTax?.year),
    owner,
    attomId: null,
    extra,
  };

  return { raw: p, record };
}
