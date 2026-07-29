/**
 * Report-token capability — the pure half (review items #7 / #10 / #14, D3).
 *
 * The report token is the ONE lead-bound capability the public surfaces use:
 *   - the /thank-you report reveal (D3),
 *   - the appointment request (D4 / #10) — replaces the raw `leadId` the
 *     browser used to POST,
 *   - the optional seller qualifiers (D15).
 *
 * It is opaque (no lead id encoded), expiring and revocable. Possession of a
 * live token is the ONLY thing that authorizes revealing an existing lead's
 * record; a contact (email/phone) match never is (D3 REVISED).
 *
 * This module stays pure so it can be unit-tested without a database — the DB
 * half lives in `reportAccess.ts`. Imports are relative, not `@/lib/*`: the
 * vitest config has no path-alias plugin (docs/lessons-learned.md §17).
 */
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * How long a freshly-issued report link stays usable. Long enough that a
 * homeowner can come back to the emailed link over a normal selling
 * conversation, short enough that a forwarded/logged URL stops working.
 */
export const REPORT_TOKEN_TTL_DAYS = 30;

/** 32 hex chars of CSPRNG — opaque, unguessable, no lead id inside. */
export function generateReportToken(): string {
  return randomBytes(16).toString('hex');
}

/** Expiry for a token issued at `issuedAt`. */
export function reportTokenExpiry(issuedAt: Date, ttlDays: number = REPORT_TOKEN_TTL_DAYS): Date {
  return new Date(issuedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

/** The stored lifecycle of a lead's report token. */
export interface ReportTokenState {
  token: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Is this token still a valid capability?
 *
 * Fails CLOSED on every ambiguous case: no token, revoked, expired, or missing
 * an expiry. The missing-expiry case matters — a row written before migration
 * 0033 has `expires_at IS NULL`, and treating "no expiry" as "never expires"
 * would quietly keep every legacy permanent token alive, which is the exact
 * defect #14 asks us to close. (0033 backfills them, so this is belt and
 * suspenders for a branch where the migration has not been applied yet.)
 */
export function isReportTokenUsable(
  state: ReportTokenState,
  now: Date = new Date(),
): boolean {
  if (!state.token) return false;
  if (state.revokedAt != null) return false;
  if (state.expiresAt == null) return false;
  return state.expiresAt.getTime() > now.getTime();
}

/**
 * Constant-time token comparison, for callers that have already loaded a
 * candidate row and want to confirm the presented token matches it without
 * leaking timing information.
 */
export function reportTokensMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
