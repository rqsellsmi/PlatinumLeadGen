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

/**
 * Best-effort state extraction from a Google-formatted address.
 *
 * Places returns "123 Main St, Brighton, MI 48116, USA", so the state code sits
 * before the ZIP. This is a stopgap that costs nothing and works on the
 * overwhelming majority of real submissions; a reverse-geocode from the stored
 * coordinates is the durable fix (D22) and belongs on the server where the key
 * is unrestricted.
 *
 * Returns null on anything it cannot parse confidently — a wrong guess here
 * either strands a Michigan lead with the admin or lets an out-of-state one
 * through, so silence is better than a guess.
 */
export function deriveStateFromAddress(address: string | null | undefined): string | null {
  const s = (address ?? '').trim();
  if (!s) return null;
  // ", XX 12345" or ", XX 12345-6789", optionally followed by ", USA".
  const m = s.match(/,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (m) return m[1].toUpperCase();
  // ", XX, USA" — no ZIP present.
  const m2 = s.match(/,\s*([A-Za-z]{2}),\s*USA\s*$/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}
