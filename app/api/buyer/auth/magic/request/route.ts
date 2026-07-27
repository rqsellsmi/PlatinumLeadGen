/**
 * POST /api/buyer/auth/magic/request — email a one-time sign-in link.
 * Turnstile + rate-limited. Never reveals whether the email exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { buyerAuthTokens } from '@/drizzle/schema';
import { generateMagicToken, hashToken, magicTokenExpiry } from '@/lib/buyerPortalAuth';
import { verifyTurnstile } from '@/lib/turnstile';
import { sendEmail, buyerMagicLinkEmail } from '@/lib/email';
import { siteUrl } from '@/lib/siteUrl';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email().max(200),
  turnstileToken: z.string().optional().nullable(),
  next: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    if (!(await checkPreset(ip, 'lead_submit'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

    if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
      return NextResponse.json({ error: 'turnstile_failed' }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();
    const token = generateMagicToken();
    await db.insert(buyerAuthTokens).values({
      email,
      tokenHash: hashToken(token),
      expiresAt: magicTokenExpiry(),
    });

    const next = parsed.data.next ? `&next=${encodeURIComponent(parsed.data.next)}` : '';
    const url = `${siteUrl()}/api/buyer/auth/magic/verify?token=${token}${next}`;
    try {
      await sendEmail(buyerMagicLinkEmail({ to: parsed.data.email, signInUrl: url }));
    } catch (err) {
      console.error('[buyer/magic/request] email failed:', err);
    }
    // Always ok — don't leak whether the address is known.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[buyer/magic/request] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
