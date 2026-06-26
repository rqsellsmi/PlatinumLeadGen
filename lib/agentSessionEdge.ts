/**
 * Edge/middleware-safe agent session verification (Web Crypto only — no node:crypto).
 * Kept in its own module so middleware.ts doesn't pull node:crypto into the Edge runtime.
 * Mirrors the signing scheme in lib/agentPortalAuth.ts: "<agentId>.<expiryMs>.<sig>".
 */

export const AGENT_SESSION_COOKIE = 'agent_session';

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
