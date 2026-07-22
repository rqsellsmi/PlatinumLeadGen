/**
 * Agent portal auth (Section 9.1 / 13.2).
 *
 * - Magic link: 64-char hex token, 30-day expiry, refreshed on every outbound email.
 * - Password: bcrypt hash in agents.passwordHash, set by admin only.
 * - Session: signed httpOnly cookie containing agentId only, 7-day expiry.
 *
 * The session cookie is signed with NEXTAUTH_SECRET using HMAC-SHA256 (Web Crypto,
 * edge-compatible) so middleware can verify it without a database round-trip.
 */
import crypto from 'crypto';

export const AGENT_SESSION_COOKIE = 'agent_session';
const SESSION_TTL_DAYS = 7;
const MAGIC_LINK_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// Magic link tokens
// ---------------------------------------------------------------------------
/** Generate a 64-char hex magic link token. */
export function generateMagicLinkToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Expiry instant for a freshly-issued magic link (30 days out). */
export function magicLinkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + MAGIC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
}

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
// Signed session cookie (HMAC) — value form: "<agentId>.<expiryMs>.<sig>"
// ---------------------------------------------------------------------------
function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set — cannot sign agent sessions.');
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

/** Create a signed session value for an agent (7-day expiry). */
export function createAgentSession(agentId: number, from: Date = new Date()): {
  value: string;
  maxAge: number;
} {
  const expiryMs = from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${agentId}.${expiryMs}`;
  const value = `${payload}.${sign(payload)}`;
  return { value, maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 };
}

/** Verify a session cookie value. Returns the agentId or null. */
export function verifyAgentSession(value: string | undefined | null, now: Date = new Date()):
  | number
  | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [agentIdStr, expiryStr, sig] = parts;
  const payload = `${agentIdStr}.${expiryStr}`;
  const expected = sign(payload);
  // Constant-time comparison.
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  const expiryMs = Number(expiryStr);
  if (!Number.isFinite(expiryMs) || expiryMs < now.getTime()) return null;
  const agentId = Number(agentIdStr);
  return Number.isInteger(agentId) ? agentId : null;
}

/**
 * Edge/middleware-safe verification using Web Crypto (no node:crypto).
 * Mirrors verifyAgentSession but async. Used in middleware.ts.
 */
export async function verifyAgentSessionEdge(
  value: string | undefined | null,
  secretKey: string,
  now: number = Date.now(),
): Promise<number | null> {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [agentIdStr, expiryStr, sig] = parts;
  const payload = `${agentIdStr}.${expiryStr}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (sig !== expected) return null;

  const expiryMs = Number(expiryStr);
  if (!Number.isFinite(expiryMs) || expiryMs < now) return null;
  const agentId = Number(agentIdStr);
  return Number.isInteger(agentId) ? agentId : null;
}
