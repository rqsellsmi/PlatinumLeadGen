/**
 * Agent portal auth (Section 9.1 / 13.2; P0.8a, decisions D6/D7, review
 * #16/#17/#18/#67/#70).
 *
 * - Magic link: 64-char hex token, 14-day expiry, **stored only as a SHA-256
 *   hash**. The raw value exists in the email that was sent and nowhere else,
 *   so reading the database row no longer yields a working login.
 * - Invite: per-agent, single-use, expiring, also hashed. Replaces the shared
 *   brokerage setup code.
 * - Password: bcrypt hash in agents.passwordHash.
 * - Session: signed httpOnly cookie carrying agentId + **sessionVersion**,
 *   7-day expiry.
 *
 * WHY THE SESSION CARRIES A VERSION. The cookie used to hold only an id and an
 * expiry, which meant nothing could invalidate it: a password reset, a
 * deactivation, or a known-leaked magic link left every outstanding 7-day
 * session working. Bumping `agents.session_version` now invalidates them all at
 * once. This is what makes the residual risk of a 14-day reusable magic link
 * (owner override, D6 REVISED) actually manageable — hashing protects the
 * database, revocation protects against a URL that got out.
 *
 * The cookie is signed with NEXTAUTH_SECRET using HMAC-SHA256 (Web Crypto,
 * edge-compatible) so middleware can verify it without a database round-trip.
 * The VERSION comparison necessarily needs the database, so it happens
 * server-side in `getCurrentAgent()` — edge does the cheap signature and expiry
 * check, the server does the authoritative one.
 */
import crypto from 'crypto';

export const AGENT_SESSION_COOKIE = 'agent_session';
const SESSION_TTL_DAYS = 7;

/**
 * 14 days, down from 30 (D6).
 *
 * The owner has explicitly overridden the review's 10-15 minute
 * single-use recommendation, accepting the residual risk for a small, known
 * roster. Worth being honest about what that means: a 14-day link is still a
 * REUSABLE BEARER credential, and hashing at rest does not protect it once the
 * URL itself is copied, forwarded, logged or intercepted. The compensating
 * controls are the ones that survive that: hash at rest, the "request a fresh
 * link" path, and session-version revocation.
 */
const MAGIC_LINK_TTL_DAYS = 14;

/** Invites are longer-lived than a password reset — an agent may be away. */
const INVITE_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Token hashing
// ---------------------------------------------------------------------------
/**
 * Hash a bearer token for storage.
 *
 * Plain SHA-256, deliberately: unlike a password, this token is 32 bytes of
 * CSPRNG output, so it has no guessable structure for an offline attack to
 * exploit and a slow KDF would buy nothing. It also has to be looked up by
 * value on every login, which a per-row salt would make impossible.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Magic link tokens
// ---------------------------------------------------------------------------
/** Generate a 64-char hex magic link token. */
export function generateMagicLinkToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Expiry instant for a freshly-issued magic link (14 days out). */
export function magicLinkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + MAGIC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * A null expiry counts as EXPIRED, not as "never expires". Failing closed here
 * means a row written before expiries existed cannot act as a permanent
 * credential.
 */
export function isTokenExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() < now.getTime();
}

// ---------------------------------------------------------------------------
// Password reset tokens (emailed "forgot password" link) — short-lived.
// ---------------------------------------------------------------------------
const PASSWORD_RESET_TTL_HOURS = 2;

/** Generate a 64-char hex password-reset token. */
export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Expiry instant for a freshly-issued reset link (2 hours out). */
export function passwordResetExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// First-time invite tokens (replaces the shared setup code — D7 / #17)
// ---------------------------------------------------------------------------
/** Generate a 64-char hex invite token. */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Expiry instant for a freshly-issued invite (7 days out). */
export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Signed session cookie (HMAC)
// value form: "<agentId>.<sessionVersion>.<expiryMs>.<sig>"
// ---------------------------------------------------------------------------
function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set — cannot sign agent sessions.');
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

export interface AgentSessionClaims {
  agentId: number;
  /** Must still match agents.session_version, or the session is revoked. */
  sessionVersion: number;
}

/** Create a signed session value for an agent (7-day expiry). */
export function createAgentSession(
  agentId: number,
  sessionVersion: number = 0,
  from: Date = new Date(),
): { value: string; maxAge: number } {
  const expiryMs = from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${agentId}.${sessionVersion}.${expiryMs}`;
  const value = `${payload}.${sign(payload)}`;
  return { value, maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 };
}

/**
 * Parse a session cookie value into its claims, WITHOUT verifying the
 * signature. Split out so both the node and edge verifiers share one definition
 * of the format — including the 3-part legacy shape.
 */
export function parseSessionValue(
  value: string | undefined | null,
): { payload: string; sig: string; agentId: number; sessionVersion: number; expiryMs: number } | null {
  if (!value) return null;
  const parts = value.split('.');

  // Current: <agentId>.<version>.<expiry>.<sig>
  // Legacy:  <agentId>.<expiry>.<sig>  — minted before session versions
  // existed. Treated as version 0, which is the column default, so nobody is
  // logged out by the deploy that introduces this.
  let agentIdStr: string;
  let versionStr: string;
  let expiryStr: string;
  let sig: string;
  if (parts.length === 4) {
    [agentIdStr, versionStr, expiryStr, sig] = parts;
  } else if (parts.length === 3) {
    [agentIdStr, expiryStr, sig] = parts;
    versionStr = '0';
  } else {
    return null;
  }

  const agentId = Number(agentIdStr);
  const sessionVersion = Number(versionStr);
  const expiryMs = Number(expiryStr);
  if (!Number.isInteger(agentId) || !Number.isInteger(sessionVersion)) return null;
  if (!Number.isFinite(expiryMs)) return null;

  const payload = parts.length === 4 ? `${agentIdStr}.${versionStr}.${expiryStr}` : `${agentIdStr}.${expiryStr}`;
  return { payload, sig, agentId, sessionVersion, expiryMs };
}

/**
 * Verify a session cookie value. Returns the claims or null.
 *
 * NOTE: this proves the cookie is authentic and unexpired. It does NOT prove
 * the session is still live — that requires comparing `sessionVersion` against
 * the database, which `getCurrentAgent()` does.
 */
export function verifyAgentSession(
  value: string | undefined | null,
  now: Date = new Date(),
): AgentSessionClaims | null {
  const parsed = parseSessionValue(value);
  if (!parsed) return null;
  const expected = sign(parsed.payload);
  if (
    parsed.sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(parsed.sig), Buffer.from(expected))
  ) {
    return null;
  }
  if (parsed.expiryMs < now.getTime()) return null;
  return { agentId: parsed.agentId, sessionVersion: parsed.sessionVersion };
}
