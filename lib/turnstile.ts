/**
 * Cloudflare Turnstile server-side verification (invisible bot check on the
 * magic-link request). No-op "pass" when unconfigured, so dev/preview and any
 * environment without the key aren't blocked — the same fail-safe posture the SMS
 * layer uses. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY (client) + TURNSTILE_SECRET_KEY
 * (server) to turn it on.
 */
export function turnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyTurnstile(token: string | null | undefined, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured → no-op pass
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}
