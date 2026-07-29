/**
 * POST /api/appointments — thank-you page appointment request. (Section 4.7)
 *
 * P0.3 (review #10/#11, decisions D4 + D5). This endpoint used to be entirely
 * unauthenticated and unlimited: it accepted an arbitrary `leadId` from the
 * browser and, on that alone, wrote an appointment row, wrote a lead-event,
 * queued a Google Ads conversion and emailed an agent. Anyone could attach any
 * of that to any lead by guessing an integer.
 *
 * It now requires the lead-bound CAPABILITY (the report token). The appointment
 * form is only ever reachable with one, so nothing legitimate is lost, and a
 * bare id is no longer sufficient to touch a lead.
 *
 * On the conversion (D4 MODIFIED): submitting this form is a lead SIGNAL, not a
 * confirmed appointment. It still enqueues `appointment_requested` so the
 * thank-you -> request funnel stays measurable, but that action must be
 * configured SECONDARY (observation only) in Google Ads. The bidding-quality
 * "Appointment" conversion is `appointment_set`, fired when an AGENT confirms
 * one (lib/statusUpdates.ts). This route awards no agent points and does not
 * move the lead's stage — it never did, and it still must not.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appointmentRequests, leadEvents, leads } from '@/drizzle/schema';
import { appointmentSchema } from '@/lib/validation';
import { sendEmail, appointmentNotificationEmail } from '@/lib/email';
import { attributionColumns } from '@/lib/attributionServer';
import { enqueueGoogleAdsAppointment } from '@/lib/googleAdsOutbox';
import { resolveReportToken } from '@/lib/reportAccess';
import { checkPreset, checkCapabilityLimit, clientIp } from '@/lib/rateLimit';
import {
  evaluateAbuseSignals,
  exceedsPayloadLimit,
  MAX_PUBLIC_BODY_BYTES,
} from '@/lib/abuseMitigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Window in which an identical idempotency key is treated as the same request. */
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    if (exceedsPayloadLimit(req.headers.get('content-length'), MAX_PUBLIC_BODY_BYTES)) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    if (!(await checkPreset(clientIp(req.headers), 'appointment'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = appointmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    const abuse = evaluateAbuseSignals({
      honeypot: input.company,
      formLoadedAt: input.formLoadedAt,
    });
    if (abuse.action === 'reject') {
      // Answer 200 so a bot learns nothing about why it failed, and log it so
      // the abuse rate stays visible for the Turnstile tripwire (D5).
      console.warn(`[api/appointments] rejected: ${abuse.reason}`);
      return NextResponse.json({ success: true });
    }

    // ----- Authorize against the lead-bound capability (D3 / #10) ----------
    // No token, or a token that has expired or been revoked, means we do not
    // know which lead this belongs to. The request is still recorded — a real
    // person clicking an old report link should not lose their request — but it
    // is UNLINKED: no lead event, no conversion, no lead association.
    let leadId: number | null = null;
    if (input.reportToken) {
      if (!(await checkCapabilityLimit(input.reportToken, 'appointment'))) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
      }
      const resolved = await resolveReportToken(input.reportToken);
      leadId = resolved?.leadId ?? null;
    }

    // ----- Idempotency (D5) ------------------------------------------------
    // A double-tap or a retried fetch must not produce two appointments, two
    // timeline entries and two agent emails.
    if (input.idempotencyKey) {
      const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
      const dupe = await db
        .select({ id: appointmentRequests.id })
        .from(appointmentRequests)
        .where(
          and(
            eq(appointmentRequests.idempotencyKey, input.idempotencyKey),
            gt(appointmentRequests.createdAt, since),
          ),
        )
        .limit(1);
      if (dupe[0]) return NextResponse.json({ success: true, deduped: true });
    }

    // Suppress everything downstream for a prod smoke test (D20/D23).
    let isTest = false;
    if (leadId != null) {
      const rows = await db
        .select({ isTest: leads.isTest })
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1);
      isTest = rows[0]?.isTest ?? false;
    }

    await db.insert(appointmentRequests).values({
      leadId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      preferredTime: input.preferredTime ?? null,
      notes: input.notes ?? null,
      source: 'thank-you',
      idempotencyKey: input.idempotencyKey ?? null,
      abuseFlag: abuse.action === 'flag' ? abuse.reason : null,
      ...attributionColumns(input),
    });

    if (leadId != null) {
      let apptEventId: number | null = null;
      try {
        const rows = await db
          .insert(leadEvents)
          .values({
            leadId,
            eventType: 'appointment_requested',
            note: input.preferredTime ? `Preferred: ${input.preferredTime}` : null,
          })
          .returning({ id: leadEvents.id });
        apptEventId = rows[0]?.id ?? null;
      } catch (err) {
        console.error('[api/appointments] lead event failed:', err);
      }

      // SECONDARY / observation conversion only (D4 MODIFIED) — see the header.
      // Deduped once per lead by the outbox unique index.
      if (!isTest) {
        await enqueueGoogleAdsAppointment({
          leadId,
          sourceEventId: apptEventId,
          occurredAt: new Date(),
        });
      }
    }

    if (!isTest) {
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
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/appointments] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
