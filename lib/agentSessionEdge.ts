/**
 * Edge/middleware-safe agent session verification (Web Crypto only — no
 * node:crypto). Kept in its own module so middleware.ts doesn't pull
 * node:crypto into the Edge runtime.
 *
 * Mirrors the signing scheme in lib/agentPortalAuth.ts:
 *   "<agentId>.<sessionVersion>.<expiryMs>.<sig>"  (current)
 *   "<agentId>.<expiryMs>.<sig>"                    (legacy, version 0)
 *
 * SCOPE: this proves the cookie is authentic and unexpired. It deliberately
 * does NOT check `agents.session_version` or `agents.is_active` — both need a
 * database read, which the Edge runtime should not be doing on every request.
 * `getCurrentAgent()` (lib/agentSession.ts) performs those authoritative checks
 * on the server side, downstream of this gate, and every page and route that
 * exposes seller PII goes through it.
 */

export const AGENT_SESSION_COOKIE = 'agent_session';

export interface EdgeSessionClaims {
  agentId: number;
  sessionVersion: number;
}

export async function verifyAgentSessionEdge(
  value: string | undefined | null,
  secretKey: string,
  now: number = Date.now(),
): Promise<EdgeSessionClaims | null> {
  if (!value) return null;
  // An unset NEXTAUTH_SECRET must not silently become an empty HMAC key — that
  // would make every forged cookie verifiable. The node path throws in this
  // case; edge middleware can't, so it refuses instead.
  if (!secretKey) return null;

  const parts = value.split('.');
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
  const payload = parts.length === 4 ? `${agentIdStr}.${versionStr}.${expiryStr}` : `${agentIdStr}.${expiryStr}`;

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
  if (!timingSafeEqualHex(sig, expected)) return null;

  const expiryMs = Number(expiryStr);
  if (!Number.isFinite(expiryMs) || expiryMs < now) return null;
  const agentId = Number(agentIdStr);
  const sessionVersion = Number(versionStr);
  if (!Number.isInteger(agentId) || !Number.isInteger(sessionVersion)) return null;
  return { agentId, sessionVersion };
}

/**
 * Constant-time hex comparison. The node verifier uses `timingSafeEqual`; this
 * path used a plain `!==`, so the two halves of the same scheme had different
 * timing properties. Web Crypto has no equivalent primitive, so this is the
 * standard accumulate-XOR form.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
