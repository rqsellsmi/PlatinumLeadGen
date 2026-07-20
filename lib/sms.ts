/**
 * Telnyx SMS client — sends texts via the Telnyx Messages API (no SDK dependency).
 * No-ops gracefully when Telnyx env vars are unset, so the platform runs
 * SMS-less until you add credentials in Vercel.
 *
 * Env: TELNYX_API_KEY. Optional TELNYX_MESSAGING_PROFILE_ID attaches a
 * messaging profile to outbound messages. The sending number ("from") is
 * supplied per-call via opts.from — see lib/autoOffer.ts.
 */

export interface SmsResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  telnyxMessageId?: string;
}

/** True when the Telnyx API key is present. Office-number presence is checked per-send. */
export function telnyxConfigured(): boolean {
  return !!process.env.TELNYX_API_KEY;
}

/** Best-effort E.164 normalization; assumes US (+1) for 10-digit numbers. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    const d = trimmed.replace(/[^\d]/g, '');
    return d.length >= 8 ? `+${d}` : null;
  }
  const d = trimmed.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

/** Pure Telnyx Messages API request body. */
export function buildTelnyxPayload(from: string, to: string, text: string) {
  const body: { from: string; to: string; text: string; messaging_profile_id?: string } = { from, to, text };
  const mp = process.env.TELNYX_MESSAGING_PROFILE_ID;
  if (mp) body.messaging_profile_id = mp;
  return body;
}

/** Send one SMS via Telnyx. {skipped:true} when unconfigured or number invalid. */
export async function sendSms(
  to: string | null | undefined,
  body: string,
  opts?: { from?: string },
): Promise<SmsResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return { sent: false, skipped: true };
  const e164 = toE164(to);
  if (!e164) return { sent: false, skipped: true, error: 'invalid-or-missing-number' };
  if (!opts?.from) return { sent: false, skipped: true, error: 'no-from-number' };

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildTelnyxPayload(opts.from, e164, body)),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { sent: false, error: `telnyx ${res.status} ${txt.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
    return { sent: true, telnyxMessageId: json?.data?.id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'sms error' };
  }
}
