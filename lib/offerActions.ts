/**
 * Shared accept/decline core (Section 7.4 / Task 9) so the web offer route and
 * the SMS webhook run byte-identical logic: offer/lead field updates, the
 * 4-band response-time scoring, event logging, reassignment, and the
 * acceptance email + client-info SMS.
 *
 * HTTP concerns (rate-limiting, form parsing, the GET confirmation page,
 * session cookie, redirect/HTML responses) stay in the route — this module is
 * pure domain logic keyed by offerId.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { leadOffers, leads, agents } from '../drizzle/schema';
import { applyScore, type ScoreReason } from './scoring';
import { reassignLead } from './autoOffer';
import { logLeadEvent } from './leadEvents';
import { agentAcceptanceEmail, sendEmail } from './email';
import { sendClientInfoSms } from './clientInfoSms';
import { siteUrl } from './siteUrl';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export type OfferActionResult = {
  ok: boolean;
  reason?: 'already-responded' | 'not-found';
  leadId?: number;
  agentId?: number;
};

async function loadOfferById(offerId: number) {
  const rows = await db.select().from(leadOffers).where(eq(leadOffers.id, offerId)).limit(1);
  return rows[0] ?? null;
}

export async function applyDecline(offerId: number): Promise<OfferActionResult> {
  const offer = await loadOfferById(offerId);
  if (!offer) return { ok: false, reason: 'not-found' };
  if (offer.status !== 'offered') return { ok: false, reason: 'already-responded' };

  const now = new Date();

  await db
    .update(leadOffers)
    .set({ status: 'declined', declinedAt: now, respondedAt: now, updatedAt: now })
    .where(eq(leadOffers.id, offer.id));

  try {
    await applyScore({ agentId: offer.agentId, reason: 'system_decline', leadId: offer.leadId, leadOfferId: offer.id });
  } catch (err) {
    console.error('[offerActions] decline applyScore failed:', err);
  }

  await logLeadEvent(offer.leadId, 'offer_declined', null);

  try {
    await reassignLead(offer.leadId);
  } catch (err) {
    console.error('[offerActions] reassignLead failed:', err);
  }

  return { ok: true, leadId: offer.leadId, agentId: offer.agentId };
}

export async function applyAccept(offerId: number): Promise<OfferActionResult> {
  const offer = await loadOfferById(offerId);
  if (!offer) return { ok: false, reason: 'not-found' };
  if (offer.status !== 'offered') return { ok: false, reason: 'already-responded' };

  const now = new Date();

  await db
    .update(leadOffers)
    .set({ status: 'accepted', acceptedAt: now, respondedAt: now, tokenUsedAt: now, updatedAt: now })
    .where(eq(leadOffers.id, offer.id));
  await db
    .update(leads)
    .set({ acceptedAt: now, lastStatusChangedAt: now, updatedAt: now })
    .where(eq(leads.id, offer.leadId));

  // Response-time score, 4 bands (spec v2 §2). A null offerSentAt (queued
  // offer dispatched asynchronously) is treated as the top tier.
  {
    let reason: ScoreReason = 'system_response_fast';
    let explicitDelta: number | undefined;
    if (offer.offerSentAt) {
      const elapsed = now.getTime() - offer.offerSentAt.getTime();
      if (elapsed < FIFTEEN_MIN_MS) reason = 'system_response_fast';
      else if (elapsed <= THIRTY_MIN_MS) {
        reason = 'system_response_fast';
        explicitDelta = 6;
      } else if (elapsed <= ONE_HOUR_MS) reason = 'system_response_good';
      else reason = 'system_response_slow';
    }
    try {
      await applyScore({ agentId: offer.agentId, reason, delta: explicitDelta, leadId: offer.leadId, leadOfferId: offer.id });
    } catch (err) {
      console.error('[offerActions] accept applyScore failed:', err);
    }
  }

  await logLeadEvent(offer.leadId, 'offer_accepted', null);

  try {
    const detailRows = await db
      .select({ lead: leads, agent: agents })
      .from(leads)
      .innerJoin(agents, eq(agents.id, offer.agentId))
      .where(eq(leads.id, offer.leadId))
      .limit(1);
    const detail = detailRows[0];
    if (detail) {
      const { lead, agent } = detail;
      const leadName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'New lead';
      await sendEmail(
        agentAcceptanceEmail({
          to: agent.email,
          agentName: `${agent.firstName} ${agent.lastName}`.trim(),
          leadName,
          leadEmail: lead.email,
          leadPhone: lead.phone,
          propertyAddress: lead.propertyAddress,
          portalUrl: `${siteUrl()}/agent/leads`,
        }),
      );
    }
  } catch (err) {
    console.error('[offerActions] acceptance email failed:', err);
  }

  await sendClientInfoSms(offer.leadId, offer.agentId, offer.id);

  return { ok: true, leadId: offer.leadId, agentId: offer.agentId };
}
