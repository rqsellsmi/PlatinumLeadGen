/**
 * POST /api/webhooks/appointment — external appointment intake (API key + rate limited). (Section 7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appointmentRequests } from '@/drizzle/schema';
import { appointmentSchema } from '@/lib/validation';
import { verifyApiKey } from '@/lib/apiKeys';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { sendEmail, appointmentNotificationEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const apiKeyId = await verifyApiKey(req.headers.get('x-api-key'));
    if (apiKeyId == null) {
      return NextResponse.json({ error: 'invalid_api_key' }, { status: 401 });
    }

    if (!(await checkPreset(clientIp(req.headers), 'webhook'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = appointmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    await db.insert(appointmentRequests).values({
      leadId: input.leadId ?? null,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      preferredTime: input.preferredTime ?? null,
      notes: input.notes ?? null,
      source: 'webhook',
    });

    try {
      await sendEmail(
        appointmentNotificationEmail({
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          preferredTime: input.preferredTime ?? null,
          notes: input.notes ?? null,
        }),
      );
    } catch (err) {
      console.error('[api/webhooks/appointment] notification email failed:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/webhooks/appointment] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
