/**
 * Test-lead suppression (review item #68, decision D20/D23 MODIFIED).
 *
 * Routine testing happens in the preview/staging environment, so this is NOT a
 * general test-mode. It exists for the occasional deliberate smoke test against
 * PRODUCTION: the tester submits with a reserved contact, the lead is flagged
 * `is_test` at creation, and it is then suppressed everywhere it would
 * otherwise contaminate operations — routing/auto-offer, scoring, leaderboards,
 * agent email/SMS, Google Ads conversion exports and KPI counts.
 *
 * The allowlist is deliberately small and boring:
 *   - any address at a reserved email DOMAIN (`TEST_LEAD_EMAIL_DOMAINS`),
 *   - any phone in the 555-01xx block, which is reserved for fiction (RFC-style
 *     "no real subscriber" range) and can never belong to a live prospect.
 *
 * Pure so it can be unit-tested; env is read by the caller and passed in, which
 * also keeps `configuredTestDomains()` the single place the var is parsed.
 * Relative imports only (lessons-learned §17).
 */

/** Domains always treated as test traffic, regardless of configuration. */
const BUILT_IN_TEST_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.invalid'];

/**
 * Parse `TEST_LEAD_EMAIL_DOMAINS` (comma-separated) and merge with the built-in
 * list. `||` not `??`: an unset GitHub Actions secret arrives as `''`, and
 * "unset" and "empty" must behave identically (lessons-learned §12d).
 */
export function configuredTestDomains(raw?: string | null): string[] {
  const extra = (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return Array.from(new Set([...BUILT_IN_TEST_DOMAINS, ...extra]));
}

/**
 * The 555-01xx reserved block: NPA-555-0100 through 555-0199 in the North
 * American plan. Matches with or without a country code.
 */
export function isReservedTestPhone(phone: string | null | undefined): boolean {
  const digits = (phone || '').replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return false;
  return national.slice(3, 6) === '555' && national.slice(6, 8) === '01';
}

/** Does this email sit on a reserved test domain? */
export function isReservedTestEmail(
  email: string | null | undefined,
  domains: string[],
): boolean {
  const at = (email || '').trim().toLowerCase();
  const idx = at.lastIndexOf('@');
  if (idx < 0) return false;
  const domain = at.slice(idx + 1);
  if (!domain) return false;
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Should a lead created with this contact be flagged as a production smoke
 * test? Either signal alone is enough — a tester should not have to remember
 * both.
 */
export function isTestContact(
  contact: { email?: string | null; phone?: string | null },
  domains: string[] = configuredTestDomains(),
): boolean {
  return isReservedTestEmail(contact.email, domains) || isReservedTestPhone(contact.phone);
}
