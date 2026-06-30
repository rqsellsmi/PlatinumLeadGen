/**
 * RentCast AVM client (Section 1.2 / 4.7).
 * Used by /api/valuation to fetch an estimated home value + range, and to
 * resolve coordinates for a property address.
 */

const RENTCAST_BASE = 'https://api.rentcast.io/v1';

export interface ValuationResult {
  estimatedValue: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  latitude: number | null;
  longitude: number | null;
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
export async function getValuation(address: string): Promise<ValuationResult> {
  const url = new URL(`${RENTCAST_BASE}/avm/value`);
  url.searchParams.set('address', address);

  const res = await fetch(url.toString(), {
    headers: { 'X-Api-Key': apiKey(), Accept: 'application/json' },
    // RentCast data is not user-specific; allow brief caching at the platform edge.
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { estimatedValue: null, priceRangeLow: null, priceRangeHigh: null, latitude: null, longitude: null };
    }
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
    estimatedValue: data.price ?? null,
    priceRangeLow: data.priceRangeLow ?? (data.price ? Math.round(data.price * 0.92) : null),
    priceRangeHigh: data.priceRangeHigh ?? (data.price ? Math.round(data.price * 1.08) : null),
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
  };
}
