/**
 * Buyer portal auth — a THIRD, isolated principal (separate from admin NextAuth
 * and the agent session). Passwordless: Google OAuth + email magic link. No
 * credentials are stored.
 *
 * Session: a signed httpOnly cookie carrying buyerUserId only, 30-day rolling
 * expiry. Signed with BUYER_SESSION_SECRET (falls back to NEXTAUTH_SECRET) via
 * HMAC-SHA256 so middleware can verify it edge-side without a DB round-trip. This
 * mirrors lib/agentPortalAuth.ts but with its own cookie + secret, so the admin
 * and agent guards never accept a buyer session and vice-versa.
 */
import crypto from 'crypto';

export const BUYER_SESSION_COOKIE = 'bx_session';
const SESSION_TTL_DAYS = 30;
const MAGIC_TTL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Magic-link tokens (store the HASH, never the raw token)
// ---------------------------------------------------------------------------
export function generateMagicToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** SHA-256 hex of a token — what we persist + look up by. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function magicTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + MAGIC_TTL_MINUTES * 60 * 1000);
}

export function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() < now.getTime();
}

// ---------------------------------------------------------------------------
// Signed session cookie (HMAC) — value form: "<buyerUserId>.<expiryMs>.<sig>"
// ---------------------------------------------------------------------------
export function buyerSessionSecret(): string {
  const s = process.env.BUYER_SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('BUYER_SESSION_SECRET / NEXTAUTH_SECRET not set — cannot sign buyer sessions.');
  return s;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Create a signed session value for a buyer (30-day expiry). */
export function createBuyerSession(
  buyerUserId: number,
  from: Date = new Date(),
): { value: string; maxAge: number } {
  const expiryMs = from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${buyerUserId}.${expiryMs}`;
  const value = `${payload}.${sign(payload, buyerSessionSecret())}`;
  return { value, maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 };
}

/** Verify a session cookie value (Node crypto). Returns buyerUserId or null. */
export function verifyBuyerSession(
  value: string | undefined | null,
  now: Date = new Date(),
): number | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [idStr, expiryStr, sig] = parts;
  const payload = `${idStr}.${expiryStr}`;
  const expected = sign(payload, buyerSessionSecret());
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  const expiryMs = Number(expiryStr);
  if (!Number.isFinite(expiryMs) || expiryMs < now.getTime()) return null;
  const id = Number(idStr);
  return Number.isInteger(id) ? id : null;
}

/**
 * Edge/middleware-safe verification using Web Crypto (no node:crypto). Mirrors
 * verifyBuyerSession but async. Used in middleware.ts.
 */
export async function verifyBuyerSessionEdge(
  value: string | undefined | null,
  secretKey: string,
  now: number = Date.now(),
): Promise<number | null> {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [idStr, expiryStr, sig] = parts;
  const payload = `${idStr}.${expiryStr}`;

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
  const id = Number(idStr);
  return Number.isInteger(id) ? id : null;
}
