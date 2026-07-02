/**
 * Twilio SMS client — sends texts via the Twilio REST API (no SDK dependency).
 * No-ops gracefully when Twilio env vars are unset, so the platform runs
 * SMS-less until you add credentials in Vercel.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164, e.g.
 * +15551234567). Optional TWILIO_MESSAGING_SERVICE_SID overrides the from
 * number if you use a Messaging Service.
 */

export interface SmsResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
}

function creds(): { sid: string; token: string; from: string; messagingServiceSid?: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || undefined;
  if (!sid || !token || (!from && !messagingServiceSid)) return null;
  return { sid, token, from: from ?? '', messagingServiceSid };
}

/** True when Twilio is configured (used to gate alert sends). */
export function smsConfigured(): boolean {
  return creds() != null;
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

/** Send an SMS. Returns {skipped:true} when Twilio isn't configured. */
export async function sendSms(to: string | null | undefined, body: string): Promise<SmsResult> {
  const c = creds();
  if (!c) return { sent: false, skipped: true };
  const e164 = toE164(to);
  if (!e164) return { sent: false, skipped: true, error: 'invalid-or-missing-number' };

  try {
    const auth = Buffer.from(`${c.sid}:${c.token}`).toString('base64');
    const params = new URLSearchParams({ To: e164, Body: body });
    if (c.messagingServiceSid) params.set('MessagingServiceSid', c.messagingServiceSid);
    else params.set('From', c.from);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { sent: false, error: `twilio ${res.status} ${txt.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'sms error' };
  }
}
