/**
 * RentCast AVM client (Section 1.2 / 4.7).
 * One of the interchangeable valuation providers behind lib/valuation.ts.
 * Returns the shared ValuationResult shape; RentCast has no property-detail
 * data, so `basics`, `confidenceScore`, and `saleHistory` come back empty.
 */

import type { ValuationResult } from './valuation';

const RENTCAST_BASE = 'https://api.rentcast.io/v1';

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
