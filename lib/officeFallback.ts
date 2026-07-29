/**
 * The verified brokerage office of record — one source of truth (P0.4, #32).
 *
 * The site footer used to carry a hardcoded BRIGHTON_FALLBACK containing a
 * FABRICATED address ("123 W Grand River Ave") and a 555 phone number
 * ("(810) 555-0199"), rendered as a live tel: link on ANY database error — not
 * just an empty offices table. A real prospect hitting the site during a DB
 * blip would have been shown a placeholder address and invited to dial a number
 * that does not exist. It also contradicted the /terms and /privacy pages,
 * which carry the real details.
 *
 * These values are transcribed from those legal pages (app/terms/page.tsx and
 * app/privacy/page.tsx, "Contact Us"), which are the brokerage's published
 * contact of record. Michigan LARA requires the employing broker's identity and
 * phone or address on real-estate advertising, so this must always be real.
 *
 * Relative imports only (lessons-learned §17).
 */

export interface OfficeContact {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

/**
 * Used only when the offices table is empty or unreachable. It is the real
 * Brighton office, so a degraded render is still truthful and still dialable.
 */
export const BROKER_OFFICE_OF_RECORD: OfficeContact = {
  name: 'RE/MAX Platinum',
  address: '6870 Grand River Ave',
  city: 'Brighton',
  state: 'MI',
  zip: '48114',
  phone: '810-227-4600',
};

/**
 * Build a `tel:` href from a display phone number.
 *
 * Returns null rather than a broken link when there are no usable digits — a
 * `tel:` with nothing behind it is worse than plain text. Assumes NANP: a bare
 * 10-digit number gets +1; an 11-digit number starting with 1 is already
 * country-coded.
 */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`;
  return null;
}
