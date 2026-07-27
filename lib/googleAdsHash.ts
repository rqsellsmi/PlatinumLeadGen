/**
 * Enhanced-conversion identifier hashing for the Google Ads Data Manager API.
 * Pure functions (Node `crypto` only) — relative imports so vitest can load it
 * (the `@/` alias trap, lessons §17).
 *
 * Rules (Data Manager "Conversion event data requirements", vendor §8):
 *  - Email: trim + lowercase; for gmail.com / googlemail.com strip dots from
 *    the local part. Then SHA-256.
 *  - Phone: E.164 (reuse the platform's toE164), then SHA-256.
 *  - Output: lowercase 64-char hex, UTF-8 bytes, encoding=HEX.
 *  - Never hash a value already a SHA-256 digest; never hash click ids.
 */
import { createHash } from 'crypto';
import { toE164 } from './sms';

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Normalize an email for enhanced-conversion hashing. Returns '' if unusable. */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  let e = email.trim().toLowerCase();
  const at = e.indexOf('@');
  if (at > 0) {
    let local = e.slice(0, at);
    const domain = e.slice(at + 1);
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      local = local.replace(/\./g, '');
    }
    e = `${local}@${domain}`;
  }
  return e;
}

/** SHA-256 → lowercase 64-hex. Pass-through if the input is already a digest. */
export function sha256Hex(value: string): string {
  if (SHA256_HEX.test(value)) return value; // never re-hash
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hashed email identifier, or null when there's no usable email. */
export function hashedEmail(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return null;
  return sha256Hex(normalized);
}

/** Hashed E.164 phone identifier, or null when the number can't be normalized. */
export function hashedPhone(phone: string | null | undefined): string | null {
  const e164 = toE164(phone);
  if (!e164) return null;
  return sha256Hex(e164);
}
