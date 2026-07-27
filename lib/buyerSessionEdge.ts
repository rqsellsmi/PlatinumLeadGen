/**
 * Edge/middleware-safe buyer session verification (Web Crypto only — no
 * node:crypto). Kept in its own module so middleware.ts doesn't pull node:crypto
 * into the Edge runtime. Mirrors lib/buyerPortalAuth.ts: "<buyerUserId>.<expiryMs>.<sig>".
 */

export const BUYER_SESSION_COOKIE = 'bx_session';

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
