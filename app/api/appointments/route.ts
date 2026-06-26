/**
 * POST /api/appointments — thank-you page appointment request. (Section 4.7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appointmentRequests } from '@/drizzle/schema';
import { appointmentSchema } from '@/lib/validation';
import { sendEmail, appointmentNotificationEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
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
      source: 'thank-you',
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
      console.error('[api/appointments] notification email failed:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/appointments] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
