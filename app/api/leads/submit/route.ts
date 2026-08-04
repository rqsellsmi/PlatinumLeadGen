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
import {
  sendEmail,
  homeownerConfirmationEmail,
  leadResubmittedEmail,
  existingReportLinkEmail,
} from '@/lib/email';
import { ensureReportToken, reportUrl } from '@/lib/reportAccess';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { attributionColumns } from '@/lib/attributionServer';
import { findLeadByEmail, normalizedAddressKey } from '@/lib/leadDedup';
import { alertAdminOfPhoneCollision } from '@/lib/leadDuplicateAlert';
import { logLeadEvent } from '@/lib/leadEvents';
import { enqueueGoogleAdsAcquisition } from '@/lib/googleAdsOutbox';
import {
  decideLeadIdentity,
  buildSubmitResponse,
  reportLinkRecipient,
  type LeadIdentityDecision,
} from '@/lib/leadIdentity';
import { isTestContact, configuredTestDomains } from '@/lib/testLeads';
import {
  evaluateAbuseSignals,
  exceedsPayloadLimit,
  MAX_PUBLIC_BODY_BYTES,
} from '@/lib/abuseMitigation';
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
 * Email the durable report link to the address ON FILE (decision D3).
 *
 * This is the possession check. A submit that matched an existing lead by email
 * or phone proves nothing about who is typing, so nothing goes back to the
 * browser — the link goes to the inbox already on the record, and clicking it
 * is what authorizes the reveal. Deliberately NOT sent to the address just
 * submitted: if the match came from a shared, recycled or mistyped phone, that
 * would hand the record straight to the wrong person.
 *
 * Returns whether the send succeeded, so the form can say "check your email"
 * only when that is actually true.
 */
async function emailExistingReportLink(
  decision: LeadIdentityDecision,
  lead: Lead,
  citySlug: string | null | undefined,
): Promise<boolean> {
  const to = reportLinkRecipient(decision);
  if (!to) return false; // nothing on file to verify possession against
  try {
    const token = await ensureReportToken(lead.id);
    if (!token) return false;
    const res = await sendEmail(
      existingReportLinkEmail({
        to,
        firstName: lead.firstName,
        reportUrl: reportUrl(citySlug, token),
        relatedLeadId: lead.id,
      }),
    );
    return res.ok;
  } catch (err) {
    console.error('[api/leads/submit] existing report link email failed:', err);
    return false;
  }
}

/**
 * Record an additional valuation this lead ran (D3). A lead is a person, not an
 * address — one lead may value several homes over time, so each run lands on
 * the activity timeline instead of changing whose lead it is.
 */
async function recordValuationRun(leadId: number, address: string | null | undefined) {
  await logLeadEvent(leadId, 'valuation_run', address ?? null);
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
    if (exceedsPayloadLimit(req.headers.get('content-length'), MAX_PUBLIC_BODY_BYTES)) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    if (!(await checkPreset(clientIp(req.headers), 'lead_submit'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = leadSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    // Cheap abuse signals (P0.3 / D5 MODIFIED). A filled honeypot is rejected
    // outright — it has no innocent explanation. An implausibly fast completion
    // is FLAGGED and still processed: losing a real seller lead we paid Google
    // for costs far more than storing one spam row.
    const abuse = evaluateAbuseSignals({
      honeypot: input.company,
      formLoadedAt: input.formLoadedAt,
    });
    if (abuse.action === 'reject') {
      console.warn(`[api/leads/submit] rejected: ${abuse.reason}`);
      return NextResponse.json({ success: true, existingRecord: true, reportLinkEmailed: false });
    }
    const locationId = await resolveLocationId(input.locationSlug);
    const now = new Date();
    const email = input.email;
    // Coalesce blank/whitespace optional fields to NULL. The public forms submit
    // `phone: ""` (etc.) when left empty, and `?? null` only catches null/undefined
    // — so without this, blanks land as empty strings, not NULL.
    const phone = (input.phone ?? '').trim() || null;
    const firstName = (input.firstName ?? '').trim() || null;
    const lastName = (input.lastName ?? '').trim() || null;
    const pageVariant = input.pageVariant ?? 'seo';

    // ----- Identity (P0.1 / decision D3, email-primary) --------------------
    //
    // EMAIL is the identity key. A different email is a different lead; a
    // matching phone alone does NOT merge (numbers are shared, recycled and
    // mistyped). The old cross-session ADDRESS dedup is gone for the same
    // reason — a spouse, tenant, new owner or neighbour all reach the same
    // address, and it used to hand them the prior lead's id and report token.
    //
    // Even an email match is used INTERNALLY ONLY: the browser is told nothing
    // about the existing lead (see lib/leadIdentity.ts). A phone that matches a
    // DIFFERENT-email lead is handled separately, as an admin heads-up, after
    // the new lead is created — never as a merge.
    const contactMatch = await findLeadByEmail(email);

    // This browser session's own CONTACT-LESS partial. `isNull(email)` matters:
    // if this session already produced a full lead and a different contact now
    // submits, that is a second person, so they get a second lead rather than
    // overwriting the first (D3: each distinct contact is its own lead).
    const sessionRows = contactMatch
      ? []
      : await db
          .select({ id: leads.id })
          .from(leads)
          .where(
            and(
              eq(leads.sessionId, input.sessionId),
              eq(leads.isDeleted, false),
              isNull(leads.email),
            ),
          )
          .limit(1);

    const decision = decideLeadIdentity({
      contactMatch: contactMatch
        ? { id: contactMatch.id, status: contactMatch.status, email: contactMatch.email }
        : null,
      sessionPartial: sessionRows[0] ?? null,
    });

    if (decision.kind === 'reopen' || decision.kind === 'duplicate_contact') {
      const existing = contactMatch!;

      if (decision.kind === 'reopen') {
        // Spec v2 §4.4: a Lost lead whose contact submitted again is a real
        // returning client — reset the lifecycle clocks and the Contacted
        // precondition, and route back to the same agent when still assigned
        // and active, else route fresh. All internal; nothing is disclosed.
        await reopenLostLead(existing, email, phone);
      } else {
        await logLeadEvent(
          existing.id,
          'duplicate_submission',
          `Resubmitted via ${pageVariant} page`,
        );
        await notifyAssignedAgentOfResubmit(existing, email, phone);
      }

      // The valuation the visitor just ran belongs on this lead's timeline —
      // one lead, many runs (D3). This is an EMAIL match, so it is the same
      // person by identity and the run attaches directly. The email on file
      // equals the submitted email, so the report link (below) goes to the very
      // address they just typed; still, nothing about the existing lead — id,
      // token, PII — is returned to the browser (buildSubmitResponse), and the
      // existing lead's contact fields are not overwritten from this submission.
      await discardSessionPartial(input.sessionId, existing.id);
      await discardAddressPartials(normalizedAddressKey(input.propertyAddress), existing.id);
      await recordValuationRun(existing.id, input.propertyAddress);
      if (input.valuationToken) await linkValuationToLead(input.valuationToken, existing.id);

      // No acquisition conversion is enqueued here: this contact already
      // converted, and re-firing would double-count in Smart Bidding. The
      // outbox's UNIQUE(lead_id, milestone) index is the durable guard (D14).

      const reportLinkEmailed = await emailExistingReportLink(
        decision,
        existing,
        input.locationSlug,
      );
      return NextResponse.json(buildSubmitResponse(decision, { reportLinkEmailed }));
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
      guideId: input.guideId ?? null,
      firstName,
      lastName,
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
      // Prod smoke-test suppression (D20/D23). A reserved test email domain or a
      // 555-01xx phone flags the lead at creation so it never routes, scores,
      // notifies an agent or exports a conversion.
      isTest: isTestContact({ email, phone }, configuredTestDomains(process.env.TEST_LEAD_EMAIL_DOMAINS)),
      abuseFlag: abuse.action === 'flag' ? abuse.reason : null,
      ...attributionColumns(input),
      updatedAt: now,
    };

    // ----- Write the row -----------------------------------------------------
    // Either this browser's own contact-less partial, or a brand-new lead.
    // There is deliberately NO cross-session address branch here (D3) — see the
    // identity block above.
    let leadId: number;
    if (decision.kind === 'update_partial') {
      leadId = decision.leadId;
      await db.update(leads).set(fields).where(eq(leads.id, leadId));
    } else {
      const inserted = await db
        .insert(leads)
        .values({ sessionId: input.sessionId, status: 'new', ...fields })
        .returning({ id: leads.id });
      leadId = inserted[0].id;
    }

    const submitEventId = await logLeadEvent(leadId, 'valuation_submitted', input.propertyAddress ?? null);

    // Email-primary heads-up (D3): this lead reached the create path, so its
    // email did NOT match any existing lead. If its PHONE matches a
    // different-email lead, the admin — who can see every lead — is told right
    // away to check for the same seller with a new email vs. a shared number.
    // Suppressed for smoke-test leads. Best-effort; never blocks the response.
    if (!fields.isTest) {
      await alertAdminOfPhoneCollision({ id: leadId, firstName, lastName, email, phone });
    }

    // Google Ads website/acquisition conversion (best-effort, no-op until
    // configured): seller_valuation for valuation leads, guide_download for
    // seller_guide leads. The outbox UNIQUE(lead_id, milestone) dedups repeats.
    // Skipped for smoke-test leads so a prod test never lands in Smart Bidding.
    if (!fields.isTest) {
      await enqueueGoogleAdsAcquisition({
        leadId,
        leadType: input.leadType,
        sourceEventId: submitEventId,
        occurredAt: now,
      });
    }

    // Link the stored valuation to this lead — this is the reveal gate for the
    // detailed report page.
    if (input.valuationToken) await linkValuationToLead(input.valuationToken, leadId);

    // Clean up any other unnamed partials at this address (repeat/abandoned entries).
    await discardAddressPartials(fields.normalizedAddress, leadId);

    // Count the valuation REQUEST for this location. This is an internal
    // operations metric only (D2) — it counts form submissions, not sales, and
    // must never reach a public surface. Public "homes sold" is driven by
    // verified transactions (market_stats / IDX office deals).
    if (locationId != null && !fields.isTest) {
      try {
        await db
          .update(locations)
          .set({ valuationRequestsCount: sql`${locations.valuationRequestsCount} + 1` })
          .where(eq(locations.id, locationId));
      } catch (err) {
        console.error('[api/leads/submit] valuationRequestsCount increment failed:', err);
      }
    }

    // Routing + confirmation must not 500 the request.
    if (fields.isTest) {
      console.info(`[api/leads/submit] lead ${leadId} flagged is_test — routing suppressed`);
    } else {
      try {
        await autoOfferLead(leadId);
      } catch (err) {
        console.error('[api/leads/submit] autoOfferLead failed:', err);
      }
    }

    // Durable report link (IDX spec §5.3) — generate before the email so the
    // link is included, and return it so the client can redirect to the report.
    // This browser created the lead, so it is entitled to its own capability.
    const token = await ensureReportToken(leadId);

    if (email) {
      try {
        await sendEmail(
          homeownerConfirmationEmail({
            to: email,
            firstName,
            city: input.propertyCity ?? null,
            relatedLeadId: leadId,
            reportUrl: token ? reportUrl(input.locationSlug, token) : null,
          }),
        );
      } catch (err) {
        console.error('[api/leads/submit] confirmation email failed:', err);
      }
    }

    return NextResponse.json(
      buildSubmitResponse(decision, { ownLead: { leadId, reportToken: token } }),
    );
  } catch (err) {
    console.error('[api/leads/submit] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
