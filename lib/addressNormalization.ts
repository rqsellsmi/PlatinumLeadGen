/**
 * Address normalization helpers.
 * Normalizes free-form / Google Places address strings into consistent parts
 * for storage and de-duplication.
 */

const STATE_ABBR: Record<string, string> = {
  michigan: 'MI',
  mi: 'MI',
  ohio: 'OH',
  indiana: 'IN',
  illinois: 'IL',
};

const STREET_SUFFIX: Record<string, string> = {
  street: 'St',
  st: 'St',
  avenue: 'Ave',
  ave: 'Ave',
  boulevard: 'Blvd',
  blvd: 'Blvd',
  drive: 'Dr',
  dr: 'Dr',
  road: 'Rd',
  rd: 'Rd',
  lane: 'Ln',
  ln: 'Ln',
  court: 'Ct',
  ct: 'Ct',
  circle: 'Cir',
  place: 'Pl',
  parkway: 'Pkwy',
  pkwy: 'Pkwy',
  way: 'Way',
  terrace: 'Ter',
  trail: 'Trl',
};

export interface NormalizedAddress {
  full: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      const suffix = STREET_SUFFIX[w];
      if (suffix) return suffix;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ')
    .trim();
}

/** Collapse whitespace and trim. */
export function cleanWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a US address string of the rough form
 * "123 Main St, Brighton, MI 48116, USA" into normalized parts.
 * Best-effort — returns nulls for parts it cannot identify.
 */
export function normalizeAddress(input: string): NormalizedAddress {
  const cleaned = cleanWhitespace(input).replace(/,\s*USA$/i, '');
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);

  let street: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  let zip: string | null = null;

  if (parts.length >= 1) street = titleCase(parts[0]);
  if (parts.length >= 2) city = titleCase(parts[1]);

  if (parts.length >= 3) {
    // Third part typically "MI 48116" or "Michigan 48116"
    const m = parts[2].match(/^([A-Za-z\s]+?)\s*(\d{5}(?:-\d{4})?)?$/);
    if (m) {
      const rawState = m[1].trim().toLowerCase();
      state = STATE_ABBR[rawState] ?? rawState.toUpperCase().slice(0, 2);
      zip = m[2] ?? null;
    }
  }

  // If no explicit zip found above, try to find one anywhere.
  if (!zip) {
    const zipMatch = cleaned.match(/\b(\d{5}(?:-\d{4})?)\b/);
    zip = zipMatch ? zipMatch[1] : null;
  }

  const full = [street, city, state && zip ? `${state} ${zip}` : state]
    .filter(Boolean)
    .join(', ');

  return { full: full || cleaned, street, city, state, zip };
}
