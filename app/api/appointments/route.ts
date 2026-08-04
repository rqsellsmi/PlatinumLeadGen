/**
 * POST /api/appointments — appointment request. (Section 4.7)
 *
 * P0.3 (review #10/#11, decisions D4 + D5). This endpoint used to accept an
 * arbitrary `leadId` from the browser and, on that alone, write an appointment
 * row, a lead-event, a conversion and an agent email — anyone could attach any
 * of that to any lead by guessing an integer. The lead-bound report TOKEN
 * replaced that: it is proof the request belongs to a lead.
 *
 * The token is a PREFILL + ASSOCIATION capability, not permission to submit
 * (owner decision). So the endpoint never rejects a tokenless request; it
 * resolves who the lead is in three cases:
 *
 *   1. Valid token   → attach to that existing lead.
 *   2. No/invalid token, email matches an existing lead (email is the identity
 *      key, D3) → attach to that lead. Nothing about it is disclosed.
 *   3. No/invalid token, no email match → CREATE a new `appointment` lead from
 *      the submitted details and route it, so the request becomes a real lead
 *      instead of an orphaned row.
 *
 * On the conversions (D4 MODIFIED): submitting this form is a lead SIGNAL, not a
 * confirmed appointment. It enqueues `appointment_requested` (configure as
 * SECONDARY/observation in Google Ads) for funnel measurement, and — only when
 * the form CREATED the lead — the `appointment_lead` acquisition. The
 * bidding-quality "Appointment" conversion is `appointment_set`, fired when an
 * AGENT confirms one (lib/statusUpdates.ts). This route awards no agent points
 * and does not move a lead's stage; creating and offering a new lead is normal
 * routing, not appointment confirmation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appointmentRequests, leadEvents, leads } from '@/drizzle/schema';
import { appointmentSchema } from '@/lib/validation';
import { sendEmail, appointmentNotificationEmail } from '@/lib/email';
import { attributionColumns } from '@/lib/attributionServer';
import { enqueueGoogleAdsAppointment, enqueueGoogleAdsAcquisition } from '@/lib/googleAdsOutbox';
import { resolveReportToken } from '@/lib/reportAccess';
import { findLeadByEmail, normalizedAddressKey } from '@/lib/leadDedup';
import { alertAdminOfPhoneCollision } from '@/lib/leadDuplicateAlert';
import { autoOfferLead } from '@/lib/autoOffer';
import { isTestContact, configuredTestDomains } from '@/lib/testLeads';
import { checkPreset, checkCapabilityLimit, clientIp } from '@/lib/rateLimit';
import {
  evaluateAbuseSignals,
  exceedsPayloadLimit,
  MAX_PUBLIC_BODY_BYTES,
} from '@/lib/abuseMitigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Split a single "name" field into first / last for the leads table. */
function splitName(full: string): { first: string; last: string | null } {
  const trimmed = full.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) return { first: trimmed, last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

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
      // the abuse rate stays visible for the Turnstile tripwire (D5). Nothing is
      // written — no appointment, and crucially no lead.
      console.warn(`[api/appointments] rejected: ${abuse.reason}`);
      return NextResponse.json({ success: true });
    }

    // ----- Resolve WHICH lead this belongs to (D3 / D4) --------------------
    // 1) A valid token names the lead outright. 2) Otherwise email is the
    // identity key: a match attaches to that lead. 3) No match → create one.
    const { first: firstName, last: lastName } = splitName(input.name);
    const email = input.email ?? null;
    const phone = input.phone ?? null;

    // Email is ALWAYS required — it is the identity key and the fallback contact
    // channel, and a report token's mere presence is not proof it is valid, so we
    // cannot make email conditional on it. Without an email we'd route a lead an
    // agent can't reach. Phone stays optional (owner decision).
    if (!email) {
      return NextResponse.json({ error: 'email_required' }, { status: 400 });
    }

    let leadId: number | null = null;
    if (input.reportToken) {
      if (!(await checkCapabilityLimit(input.reportToken, 'appointment'))) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
      }
      const resolved = await resolveReportToken(input.reportToken);
      leadId = resolved?.leadId ?? null;
    }

    // ----- Idempotency (D5), enforced ATOMICALLY ---------------------------
    // Claim the request by inserting its appointment row up front, guarded by
    // the UNIQUE(idempotency_key) index (migration 0040). If a concurrent or
    // earlier copy already claimed the key, ON CONFLICT DO NOTHING returns no
    // row and we stop here — so the race cannot produce a duplicate lead,
    // appointment, email or routing. The lead id is filled in below once
    // resolved; a NULL key never conflicts, so keyless requests always proceed.
    const claimed = await db
      .insert(appointmentRequests)
      .values({
        leadId,
        name: input.name,
        phone,
        email,
        preferredTime: input.preferredTime ?? null,
        notes: input.notes ?? null,
        source: 'thank-you',
        idempotencyKey: input.idempotencyKey ?? null,
        abuseFlag: abuse.action === 'flag' ? abuse.reason : null,
        ...attributionColumns(input),
      })
      .onConflictDoNothing({ target: appointmentRequests.idempotencyKey })
      .returning({ id: appointmentRequests.id });

    if (claimed.length === 0) {
      return NextResponse.json({ success: true, deduped: true });
    }
    const appointmentId = claimed[0].id;

    // Now that this request owns the claim, resolve/create the lead. The HTTP
    // DB driver has no interactive transactions, so if this essential work
    // fails we RELEASE the claim (delete the appointment row) in the catch —
    // otherwise the key would stay claimed and a retry would return a premature
    // "deduped success" with no lead, turning a transient DB blip into a lost
    // paid lead (P0.8). A retry re-runs cleanly: email is required and dedup is
    // email-primary, so if a lead was already created before the failure the
    // retry attaches to it rather than duplicating.
    let newLeadCreated = false;
    try {
    if (leadId == null) {
      const match = await findLeadByEmail(email);
      if (match) {
        // Same person by email — attach; disclose nothing about the record.
        leadId = match.id;
      } else {
        // First touch: create an appointment-origin lead from these details so
        // the request is a real, routable lead rather than an orphaned row.
        const now = new Date();
        const inserted = await db
          .insert(leads)
          .values({
            leadType: 'appointment',
            status: 'new',
            source: 'appointment',
            firstName,
            lastName,
            email,
            phone,
            propertyAddress: input.propertyAddress ?? null,
            propertyCity: input.propertyCity ?? null,
            propertyState: input.propertyState ?? null,
            propertyZip: input.propertyZip ?? null,
            propertyLat: input.propertyLat ?? null,
            propertyLng: input.propertyLng ?? null,
            normalizedAddress: normalizedAddressKey(input.propertyAddress),
            isTest: isTestContact(
              { email, phone },
              configuredTestDomains(process.env.TEST_LEAD_EMAIL_DOMAINS),
            ),
            ...attributionColumns(input),
            updatedAt: now,
          })
          .returning({ id: leads.id });
        leadId = inserted[0].id;
        newLeadCreated = true;
      }
      // Link the resolved lead onto the claimed appointment row.
      await db
        .update(appointmentRequests)
        .set({ leadId })
        .where(eq(appointmentRequests.id, appointmentId));
    }
    } catch (err) {
      // Release the claim so a retry can complete (see the note above the try).
      await db
        .delete(appointmentRequests)
        .where(eq(appointmentRequests.id, appointmentId))
        .catch((delErr) =>
          console.error('[api/appointments] failed to release idempotency claim:', delErr),
        );
      throw err;
    }

    // Everything below is best-effort and must NOT throw the handler once the
    // lead is captured — a throw here would 500 a request whose lead already
    // exists, and the retry would (correctly) dedup, skipping routing/email. So
    // the test lookup fails soft, and the event/conversion/routing/email calls
    // are each already non-throwing.
    let isTest = false;
    if (leadId != null) {
      try {
        const rows = await db
          .select({ isTest: leads.isTest })
          .from(leads)
          .where(eq(leads.id, leadId))
          .limit(1);
        isTest = rows[0]?.isTest ?? false;
      } catch (err) {
        console.error('[api/appointments] isTest lookup failed; treating as non-test:', err);
      }
    }

    let apptEventId: number | null = null;
    if (leadId != null) {
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

    // A lead the appointment form CREATED is a real acquisition: enqueue the
    // `appointment_lead` website conversion, flag a phone collision for the
    // admin (D3, email-primary), and route it to an agent. None of this fires
    // when the request attached to an existing lead — that lead already
    // acquired, and re-firing would double-count.
    if (newLeadCreated && leadId != null && !isTest) {
      await enqueueGoogleAdsAcquisition({
        leadId,
        leadType: 'appointment',
        sourceEventId: apptEventId,
        occurredAt: new Date(),
      });
      await alertAdminOfPhoneCollision({ id: leadId, firstName, lastName, email, phone });
      try {
        await autoOfferLead(leadId);
      } catch (err) {
        console.error('[api/appointments] autoOfferLead failed:', err);
      }
    }

    if (!isTest) {
      try {
        await sendEmail(
          appointmentNotificationEmail({
            name: input.name,
            phone,
            email,
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
