/**
 * Contact-field normalization for dedup and identity (D3, email-primary model).
 *
 * Pure and dependency-free so the dedup/identity logic can be unit-tested
 * without a database (lessons-learned §17). One canonical definition of "the
 * same email" and "a usable phone", used by leadDedup and the duplicate-alert
 * path, so the matching rules cannot drift apart between call sites.
 */

/** Lower-cased, trimmed email, or null if empty. Exact identity, never fuzzy. */
export function normalizedEmailKey(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase();
  return s || null;
}

/**
 * Digits-only phone, or null if fewer than 7 digits. The 7-digit floor keeps a
 * stray "123" or a partial entry from matching people on noise.
 */
export function normalizedPhoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

/**
 * Do two records identify the SAME person by email? Email is the identity key
 * (D3, email-primary): both must carry an email and they must match exactly
 * once normalized. Two missing emails are NOT "the same person".
 */
export function sameEmailIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = normalizedEmailKey(a);
  const kb = normalizedEmailKey(b);
  return ka != null && ka === kb;
}
