/**
 * Coverage rules for lead routing (P0.4, review #76, decision D22).
 *
 * Two independent guards, both pure so they can be unit-tested:
 *
 *   1. RADIUS CAP. An agent's acceptance radius was any positive finite number,
 *      and the live account was configured for 1,000 miles — a circle covering
 *      most of the eastern United States, silently participating in a Michigan
 *      seller queue. Capped at 250 miles: wide enough for the deliberate
 *      broad-coverage case (an upstate agent who also takes downstate metro
 *      leads), narrow enough to mean something.
 *
 *   2. OUT-OF-STATE GATE. 250 miles from parts of Michigan reaches Ohio,
 *      Indiana, Illinois and Ontario, so radius alone cannot keep a Michigan
 *      brokerage's queue in Michigan. A full lead on an out-of-state property
 *      is never auto-assigned; it goes to the admin, even when an agent's
 *      circle covers it.
 *
 * The simple one-radius model is a deliberate choice (D22 CONFIRMED): the
 * roster is small and known, and routing is OFFER-based, so an agent offered a
 * distant lead can decline within 3h and it reassigns. Radius over-inclusion
 * costs a decline cycle, not a mis-served lead. Multiple coverage areas are
 * deferred as over-engineering at this scale.
 *
 * Relative imports only (lessons-learned §17).
 */

/** Maximum acceptance radius any agent may be configured with (D22). */
export const MAX_PROXIMITY_RADIUS_MILES = 250;

/** Above this, the admin UI warns that a setting is unusually broad. */
export const BROAD_RADIUS_WARNING_MILES = 100;

/** The state this brokerage serves. */
export const SERVICE_AREA_STATE = 'MI';

/**
 * Normalize a submitted radius: clamp to (0, MAX], reject junk.
 *
 * Returns null for "not set", which means the brokerage default applies — the
 * existing contract. `Number.isFinite` matters: the admin editor's `num()`
 * helper only guarded against NaN, so `Infinity` (which is `> 0` and not NaN)
 * was being persisted.
 */
export function clampProximityRadius(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_PROXIMITY_RADIUS_MILES);
}

/** Should the UI warn that this radius is unusually broad? */
export function isUnusuallyBroadRadius(miles: number | null | undefined): boolean {
  return miles != null && miles > BROAD_RADIUS_WARNING_MILES;
}

/**
 * Normalize a US state to a two-letter code for comparison. Accepts the code
 * itself or the full state name; returns null for anything unrecognized, so an
 * unknown value is never silently treated as in-state.
 */
export function normalizeStateCode(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  const named: Record<string, string> = {
    michigan: 'MI',
    ohio: 'OH',
    indiana: 'IN',
    illinois: 'IL',
    wisconsin: 'WI',
  };
  return named[v.toLowerCase()] ?? null;
}

export type CoverageDecision =
  /** In the service area — route normally. */
  | { kind: 'in_state' }
  /** Confirmed out of state — never auto-assign; send to the admin. */
  | { kind: 'out_of_state'; state: string }
  /** State is unknown and cannot be derived — route normally, do not guess. */
  | { kind: 'unknown' };

/**
 * Decide whether a lead's property is inside the service area.
 *
 * IMPORTANT: `unknown` routes NORMALLY. `leads.propertyState` is NULL for every
 * organically-submitted lead today — the public forms post only the formatted
 * address and coordinates, and the Places autocomplete is never asked for
 * address components — so treating "no state" as "out of state" would send the
 * entire funnel to the admin. This mirrors the existing outside-area rule,
 * which deliberately distinguishes "outside the area" from "we can't tell where
 * the area is" (lessons-learned §20).
 *
 * Populating the state is what gives this gate teeth; see
 * `deriveStateFromAddress` for the interim source.
 */
export function decideCoverage(input: {
  propertyState?: string | null;
  propertyAddress?: string | null;
}): CoverageDecision {
  const explicit = normalizeStateCode(input.propertyState);
  const derived = explicit ?? deriveStateFromAddress(input.propertyAddress);
  if (!derived) return { kind: 'unknown' };
  if (derived === SERVICE_AREA_STATE) return { kind: 'in_state' };
  return { kind: 'out_of_state', state: derived };
}

/** The 50 states + DC — used to validate a parsed token is really a state. */
const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/**
 * Best-effort CITY extraction from a formatted address string.
 *
 * Exists so a lead offer can name a location without naming a house. The offer
 * email and text are sent before the agent has accepted, so they must not carry
 * anything that identifies or locates the seller — the street address is
 * exactly that. `leads.property_city` is populated from Places on new leads
 * (P0.4 / parsePlaceComponents), but legacy leads, webhook intake and
 * admin-created leads may only have the formatted address, and an offer with no
 * location at all is not enough for an agent to judge.
 *
 * Anchored on the state+ZIP pair rather than on comma position, so a unit
 * number ("123 Main St #4, Brighton, MI 48116") or a country suffix does not
 * shift which part is read as the city.
 *
 * SAFETY: a candidate containing a digit is rejected outright. That is what
 * stops a house number leaking when the address has no city part at all
 * ("123 Main St, MI 48116" must yield null, never "123 Main St").
 */
export function deriveCityFromAddress(address: string | null | undefined): string | null {
  const s = (address ?? '').trim();
  if (!s) return null;

  const clean = (v: string): string | null => {
    const c = v.trim().replace(/\s+/g, ' ');
    if (!c) return null;
    if (/\d/.test(c)) return null; // a street line, not a city
    return c;
  };

  // "…, <City>, <ST> <ZIP>[-1234]…"
  const withZip = s.match(/(?:^|,)\s*([^,]+?)\s*,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (withZip && US_STATE_CODES.has(withZip[2].toUpperCase())) return clean(withZip[1]);

  // "…, <City>, <ST>" or "…, <City>, <ST>, USA" — no ZIP present.
  const noZip = s.match(/(?:^|,)\s*([^,]+?)\s*,\s*([A-Za-z]{2})\s*(?:,\s*USA)?\s*$/i);
  if (noZip && US_STATE_CODES.has(noZip[2].toUpperCase())) return clean(noZip[1]);

  return null;
}

/**
 * Best-effort state extraction from an address string.
 *
 * Handles the Google-formatted case ("123 Main St, Brighton, MI 48116, USA")
 * AND looser manually-typed forms ("500 Oak, Cleveland OH 44101") — the comma
 * before the state is not required. Every candidate is validated against the
 * real US state-code set, so a stray two-letter token (a street abbreviation,
 * a unit) is never mistaken for a state. A reverse-geocode from the stored
 * coordinates remains the durable fix (D22) for coords-only leads that carry no
 * parseable address.
 *
 * Returns null on anything it cannot parse confidently — a wrong guess either
 * strands a Michigan lead with the admin or lets an out-of-state one through,
 * so silence is better than a guess.
 */
export function deriveStateFromAddress(address: string | null | undefined): string | null {
  const s = (address ?? '').trim();
  if (!s) return null;
  // "<STATE> <ZIP>" anywhere, comma optional. Take the LAST valid match (the
  // state sits near the end, after any "N Main St" that could contain letters).
  let last: string | null = null;
  const zipRe = /\b([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/g;
  for (let m = zipRe.exec(s); m; m = zipRe.exec(s)) {
    const code = m[1].toUpperCase();
    if (US_STATE_CODES.has(code)) last = code;
  }
  if (last) return last;
  // "<STATE>, USA" or "<STATE> USA" at the end — no ZIP present.
  const usa = s.match(/\b([A-Za-z]{2}),?\s*USA\s*$/i);
  if (usa && US_STATE_CODES.has(usa[1].toUpperCase())) return usa[1].toUpperCase();
  // A full state name via the named map ("…, Ohio").
  const namedTail = s.match(/,\s*([A-Za-z]+)\s*$/);
  if (namedTail) {
    const code = normalizeStateCode(namedTail[1]);
    if (code) return code;
  }
  return null;
}
