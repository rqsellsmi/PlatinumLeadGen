/**
 * Server-side geocoding via the Google Geocoding API. Turns a street address
 * into { lat, lng } so admins don't hand-enter coordinates. Returns null on any
 * failure (missing key, no match, network) — callers fall back to whatever
 * coordinates were already set.
 *
 * Uses GOOGLE_MAPS_API_KEY (server key with the Geocoding API enabled), falling
 * back to the public Maps key. Never called from the browser.
 */

function key(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    null
  );
}

export interface AddressParts {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/** Join address parts into a single geocodable string. */
export function formatAddress(p: AddressParts): string {
  return [p.address, p.city, p.state, p.zip].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
}

/**
 * Geocode an address to coordinates. Returns null if there's no key, no usable
 * address, or no result.
 */
export async function geocodeAddress(p: AddressParts): Promise<{ lat: number; lng: number } | null> {
  const k = key();
  const q = formatAddress(p);
  if (!k || q.length < 5) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', q);
    url.searchParams.set('key', k);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    };
    if (data.status !== 'OK') return null;
    const loc = data.results?.[0]?.geometry?.location;
    if (loc?.lat == null || loc?.lng == null) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch (err) {
    console.error('[geocode] failed:', err);
    return null;
  }
}
