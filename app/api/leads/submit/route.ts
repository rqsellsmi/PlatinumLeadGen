/**
 * POST /api/leads/submit — complete a lead (upgrade the partial if present),
 * dedup against prior leads, auto-offer it, and send the homeowner a
 * confirmation email. (Section 4.7 + v1.6 §C/§D)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc, sql, isNull, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, locations, leadOffers, agents } from '@/drizzle/schema';
import { leadSubmitSchema } from '@/lib/validation';
import { autoOfferLead } from '@/lib/autoOffer';
import { getValuation } from '@/lib/valuation';
import { getValuationByToken, linkValuationToLead } from '@/lib/valuationStore';
import { sendEmail, homeownerConfirmationEmail, leadResubmittedEmail } from '@/lib/email';
import { ensureReportToken, reportUrl } from '@/lib/reportAccess';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { attributionColumns } from '@/lib/attributionServer';
import { findExistingLeadByContact, findLeadByAddress, normalizedAddressKey } from '@/lib/leadDedup';
import { logLeadEvent } from '@/lib/leadEvents';
import type { Lead } from '@/drizzle/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveLocationId(slug: string | null | undefined): Promise<number | null> {
  if (!slug) return null;
  const rows = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1);
  return rows[0]?.id ?? null;
}

/** Notify the agent currently working a resubmitted lead (v1.6 §D.2). */
async function notifyAssignedAgentOfResubmit(lead: Lead, email: string | null, phone: string | null) {
  try {
    const rows = await db
      .select({ agent: agents })
      .from(leadOffers)
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(and(eq(leadOffers.leadId, lead.id), eq(leadOffers.status, 'accepted')))
      .orderBy(desc(leadOffers.acceptedAt))
      .limit(1);
    const agent = rows[0]?.agent;
    if (!agent) return;
    const leadName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'A lead';
    await sendEmail(
      leadResubmittedEmail({
        to: agent.email,
        agentName: `${agent.firstName} ${agent.lastName}`.trim(),
        leadName,
        propertyAddress: lead.propertyAddress,
        email,
        phone,
        relatedLeadId: lead.id,
        relatedAgentId: agent.id,
      }),
    );
  } catch (err) {
    console.error('[api/leads/submit] resubmit notify failed:', err);
  }
}

/**
 * Reopen a Lost lead (spec v2 §4.4): flip Lost → Reopened, reset the stall clock
 * and the Contacted precondition, and route back to the same agent if they still
 * hold it and are active; otherwise route it as a fresh lead. The prior Lost
 * episode (reason, stall penalties, point history) stays on the lead's log.
 */
async function reopenLostLead(lead: Lead, email: string | null, phone: string | null) {
  const now = new Date();
  await db
    .update(leads)
    .set({
      status: 'reopened', // behaves like New Lead in v4 (re-runs the track)
      reopenedAt: now,
      lastStatusChangedAt: now,
      reactivationCount: sql`${leads.reactivationCount} + 1`, // Lost→Reopened count (v4 §3 / D4)
      // Restart the unified update clock; the fast-engagement bonus can fire
      // again for the fresh working cycle.
      updateDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      firstEngagementLogged: false,
      stallPenaltyAt: null,
      contactedAt: null, // Lost again requires a fresh Connected
      // NOTE: milestone_* flags are intentionally NOT reset — a reopened lead
      // walked back up to Signed/Closed does not re-pay milestones (v4 §3 / D2).
      updatedAt: now,
    })
    .where(eq(leads.id, lead.id));
  await logLeadEvent(
    lead.id,
    'reopened',
    `Reopened${lead.lostReason ? ` — prior Lost (${lead.lostReason})` : ''}`,
  );

  // Same agent if the most recent accepted offer's agent is still active.
  const rows = await db
    .select({ agent: agents })
    .from(leadOffers)
    .innerJoin(agents, eq(leadOffers.agentId, agents.id))
    .where(and(eq(leadOffers.leadId, lead.id), eq(leadOffers.status, 'accepted')))
    .orderBy(desc(leadOffers.acceptedAt))
    .limit(1);
  const priorAgent = rows[0]?.agent;
  if (priorAgent?.isActive) {
    // Keep the existing assignment; notify the agent the client is back.
    await notifyAssignedAgentOfResubmit({ ...lead, status: 'reopened' }, email, phone);
    return;
  }
  // No active assigned agent → route as a fresh lead.
  try {
    await autoOfferLead(lead.id);
  } catch (err) {
    console.error('[api/leads/submit] reopen autoOffer failed:', err);
  }
}

/**
 * Soft-delete the throwaway partial lead created THIS session (via
 * /api/leads/partial) when the submit turns out to be a duplicate of a lead
 * captured in another session. Without this the partial lingers in the console
 * as an "Unnamed lead" at the same address (v1.6 §D).
 */
async function discardSessionPartial(sessionId: string, keepLeadId: number) {
  try {
    await db
      .update(leads)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(
        and(
          eq(leads.sessionId, sessionId),
          eq(leads.isDeleted, false),
          isNull(leads.email), // only the unnamed partial — never a real lead
          ne(leads.id, keepLeadId),
        ),
      );
  } catch (err) {
    console.error('[api/leads/submit] discardSessionPartial failed:', err);
  }
}

/**
 * Soft-delete any leftover UNNAMED partials at the same address once a real
 * lead exists for it (keepLeadId). Collapses repeated abandoned valuations at
 * one address that never got contact info.
 */
async function discardAddressPartials(normalizedAddress: string | null, keepLeadId: number) {
  if (!normalizedAddress) return;
  try {
    await db
      .update(leads)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(
        and(
          eq(leads.normalizedAddress, normalizedAddress),
          eq(leads.isDeleted, false),
          isNull(leads.email),
          ne(leads.id, keepLeadId),
        ),
      );
  } catch (err) {
    console.error('[api/leads/submit] discardAddressPartials failed:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'lead_submit'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = leadSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const locationId = await resolveLocationId(input.locationSlug);
    const now = new Date();
    const email = input.email;
    const phone = input.phone ?? null;
    const pageVariant = input.pageVariant ?? 'seo';

    // ----- Dedup Layer 1: contact (email/phone) against prior leads -----
    const contactMatch = await findExistingLeadByContact(email, phone);
    if (contactMatch) {
      // Reopen (spec v2 §4.4): a Lost lead whose contact submitted again is a
      // real returning client — flip Lost → Reopened, reset the lifecycle clocks
      // and the Contacted precondition, and route back to the same agent when
      // still assigned + active, else route fresh.
      if (contactMatch.status === 'lost') {
        await reopenLostLead(contactMatch, email, phone);
        await discardSessionPartial(input.sessionId, contactMatch.id);
        await discardAddressPartials(normalizedAddressKey(input.propertyAddress), contactMatch.id);
        if (input.valuationToken) await linkValuationToLead(input.valuationToken, contactMatch.id);
        return NextResponse.json({
          success: true,
          leadId: contactMatch.id,
          isReopened: true,
          reportToken: await ensureReportToken(contactMatch.id),
        });
      }

      await logLeadEvent(contactMatch.id, 'duplicate_submission', `Resubmitted via ${pageVariant} page`);
      await notifyAssignedAgentOfResubmit(contactMatch, email, phone);
      await discardSessionPartial(input.sessionId, contactMatch.id);
      await discardAddressPartials(normalizedAddressKey(input.propertyAddress), contactMatch.id);
      if (input.valuationToken) await linkValuationToLead(input.valuationToken, contactMatch.id);
      // From Google's perspective the user converted — client still fires the
      // conversion (§D.2). No new lead, no new offer.
      return NextResponse.json({
        success: true,
        leadId: contactMatch.id,
        isDuplicate: true,
        reportToken: await ensureReportToken(contactMatch.id),
      });
    }

    // Valuation fill-in. Prefer the server-stored valuation (linked by token)
    // as the authoritative source — the browser only ever saw the teaser range,
    // never these precise numbers.
    let propertyLat = input.propertyLat ?? null;
    let propertyLng = input.propertyLng ?? null;
    let estimatedValue = input.estimatedValue ?? null;
    let priceRangeLow = input.priceRangeLow ?? null;
    let priceRangeHigh = input.priceRangeHigh ?? null;
    if (input.valuationToken) {
      const stored = await getValuationByToken(input.valuationToken);
      if (stored) {
        if (estimatedValue == null) estimatedValue = stored.estimatedValue;
        if (priceRangeLow == null) priceRangeLow = stored.priceRangeLow;
        if (priceRangeHigh == null) priceRangeHigh = stored.priceRangeHigh;
        if (propertyLat == null) propertyLat = stored.latitude;
        if (propertyLng == null) propertyLng = stored.longitude;
      }
    }
    if ((propertyLat == null || propertyLng == null) && input.propertyAddress) {
      try {
        const v = await getValuation(input.propertyAddress);
        if (propertyLat == null) propertyLat = v.latitude;
        if (propertyLng == null) propertyLng = v.longitude;
        if (estimatedValue == null) estimatedValue = v.estimatedValue;
        if (priceRangeLow == null) priceRangeLow = v.priceRangeLow;
        if (priceRangeHigh == null) priceRangeHigh = v.priceRangeHigh;
      } catch (err) {
        console.error('[api/leads/submit] valuation lookup failed:', err);
      }
    }

    const fields = {
      leadType: input.leadType,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email,
      phone,
      propertyAddress: input.propertyAddress ?? null,
      propertyCity: input.propertyCity ?? null,
      propertyState: input.propertyState ?? null,
      propertyZip: input.propertyZip ?? null,
      propertyLat,
      propertyLng,
      normalizedAddress: normalizedAddressKey(input.propertyAddress),
      timeframe: input.timeframe ?? null,
      estimatedValue,
      priceRangeLow,
      priceRangeHigh,
      locationId,
      pageVariant,
      ...attributionColumns(input),
      updatedAt: now,
    };

    // ----- Choose the row to write: session partial, address merge, or new -----
    let target: { id: number } | null = null;

    const sessionRows = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.sessionId, input.sessionId), eq(leads.isDeleted, false)))
      .limit(1);
    if (sessionRows[0]) target = sessionRows[0];

    // ----- Dedup Layer 2: cross-session address -----
    if (!target && input.propertyAddress) {
      const addrMatch = await findLeadByAddress(input.propertyAddress);
      if (addrMatch) {
        if (!addrMatch.email) {
          // Partial-only prior lead at this address → merge into it.
          target = { id: addrMatch.id };
        } else {
          // Address belongs to an existing contacted lead → duplicate.
          await logLeadEvent(addrMatch.id, 'duplicate_submission', `Address resubmitted via ${pageVariant} page`);
          await notifyAssignedAgentOfResubmit(addrMatch, email, phone);
          await discardSessionPartial(input.sessionId, addrMatch.id);
          await discardAddressPartials(normalizedAddressKey(input.propertyAddress), addrMatch.id);
          if (input.valuationToken) await linkValuationToLead(input.valuationToken, addrMatch.id);
          return NextResponse.json({
            success: true,
            leadId: addrMatch.id,
            isDuplicate: true,
            reportToken: await ensureReportToken(addrMatch.id),
          });
        }
      }
    }

    let leadId: number;
    if (target) {
      leadId = target.id;
      await db.update(leads).set(fields).where(eq(leads.id, leadId));
    } else {
      const inserted = await db
        .insert(leads)
        .values({ sessionId: input.sessionId, status: 'new', ...fields })
        .returning({ id: leads.id });
      leadId = inserted[0].id;
    }

    await logLeadEvent(leadId, 'valuation_submitted', input.propertyAddress ?? null);

    // Link the stored valuation to this lead — this is the reveal gate for the
    // detailed report page.
    if (input.valuationToken) await linkValuationToLead(input.valuationToken, leadId);

    // Clean up any other unnamed partials at this address (repeat/abandoned entries).
    await discardAddressPartials(fields.normalizedAddress, leadId);

    // Increment social proof count for this location (never decremented).
    if (locationId != null) {
      try {
        await db
          .update(locations)
          .set({ socialProofCount: sql`${locations.socialProofCount} + 1` })
          .where(eq(locations.id, locationId));
      } catch (err) {
        console.error('[api/leads/submit] socialProofCount increment failed:', err);
      }
    }

    // Routing + confirmation must not 500 the request.
    try {
      await autoOfferLead(leadId);
    } catch (err) {
      console.error('[api/leads/submit] autoOfferLead failed:', err);
    }

    // Durable report link (IDX spec §5.3) — generate before the email so the
    // link is included, and return it so the client can redirect to the report.
    const token = await ensureReportToken(leadId);

    if (email) {
      try {
        await sendEmail(
          homeownerConfirmationEmail({
            to: email,
            firstName: input.firstName ?? null,
            city: input.propertyCity ?? null,
            relatedLeadId: leadId,
            reportUrl: token ? reportUrl(input.locationSlug, token) : null,
          }),
        );
      } catch (err) {
        console.error('[api/leads/submit] confirmation email failed:', err);
      }
    }

    return NextResponse.json({ success: true, leadId, reportToken: token });
  } catch (err) {
    console.error('[api/leads/submit] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
