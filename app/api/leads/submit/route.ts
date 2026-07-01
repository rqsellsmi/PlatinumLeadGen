/**
 * POST /api/leads/submit — complete a lead (upgrade the partial if present),
 * dedup against prior leads, auto-offer it, and send the homeowner a
 * confirmation email. (Section 4.7 + v1.6 §C/§D)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, locations, leadOffers, agents } from '@/drizzle/schema';
import { leadSubmitSchema } from '@/lib/validation';
import { autoOfferLead } from '@/lib/autoOffer';
import { getValuation } from '@/lib/valuation';
import { getValuationByToken, linkValuationToLead } from '@/lib/valuationStore';
import { sendEmail, homeownerConfirmationEmail, leadResubmittedEmail } from '@/lib/email';
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
      await logLeadEvent(contactMatch.id, 'duplicate_submission', `Resubmitted via ${pageVariant} page`);
      await notifyAssignedAgentOfResubmit(contactMatch, email, phone);
      if (input.valuationToken) await linkValuationToLead(input.valuationToken, contactMatch.id);
      // From Google's perspective the user converted — client still fires the
      // conversion (§D.2). No new lead, no new offer.
      return NextResponse.json({ success: true, leadId: contactMatch.id, isDuplicate: true });
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
          if (input.valuationToken) await linkValuationToLead(input.valuationToken, addrMatch.id);
          return NextResponse.json({ success: true, leadId: addrMatch.id, isDuplicate: true });
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

    if (email) {
      try {
        await sendEmail(
          homeownerConfirmationEmail({
            to: email,
            firstName: input.firstName ?? null,
            city: input.propertyCity ?? null,
            relatedLeadId: leadId,
          }),
        );
      } catch (err) {
        console.error('[api/leads/submit] confirmation email failed:', err);
      }
    }

    return NextResponse.json({ success: true, leadId });
  } catch (err) {
    console.error('[api/leads/submit] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
