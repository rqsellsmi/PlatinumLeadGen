/**
 * autoOfferLead() and reassignLead() (Section 5.5).
 * Called from /api/leads/submit and /api/webhooks/lead after a lead is saved.
 */
import crypto from 'crypto';
import { eq, inArray, and, isNull } from 'drizzle-orm';
import { db } from './db';
import {
  leads,
  agents,
  offices,
  leadOffers,
  notificationSettings,
} from '../drizzle/schema';
import { recommendAgents, type RoutingAgent } from './routing';
import { getRoutingQueue, persistQueuePointer } from './queue';
import { isWithinOfferWindow } from './offerWindow';
import { sendEmail, agentLeadOfferEmail, agentAcceptanceEmail, adminAlertEmail } from './email';
import { sendSms } from './sms';
import { generateMagicLinkToken, magicLinkExpiry } from './agentPortalAuth';
import { logLeadEvent } from './leadEvents';

/** Format a price range for emails, e.g. "$398K–$442K". */
function formatRange(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null;
  const k = (n: number | null) => (n == null ? '?' : `$${Math.round(n / 1000)}K`);
  return `${k(low)}–${k(high)}`;
}

const OFFER_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCEPTANCE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3-hour acceptance timer
const FIRST_UPDATE_MS = 48 * 60 * 60 * 1000; // 48 hours
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
}

/** Load active agents with effective coordinates (own preferred, office fallback). */
export async function getActiveRoutingAgents(): Promise<RoutingAgent[]> {
  const rows = await db
    .select({
      id: agents.id,
      lat: agents.latitude,
      lng: agents.longitude,
      score: agents.score,
      officeLat: offices.latitude,
      officeLng: offices.longitude,
    })
    .from(agents)
    .leftJoin(offices, eq(agents.officeId, offices.id))
    // Both must be true: admin keeps the agent active AND the agent hasn't
    // paused their own lead routing (Section 16.3).
    .where(and(eq(agents.isActive, true), eq(agents.isAvailable, true)));

  return rows.map((r) => ({
    id: r.id,
    lat: r.lat ?? r.officeLat ?? null,
    lng: r.lng ?? r.officeLng ?? null,
    score: r.score ?? 0,
  }));
}

/** Read (or lazily create) the single notificationSettings row. */
async function getSettings() {
  const rows = await db.select().from(notificationSettings).limit(1);
  if (rows.length > 0) return rows[0];
  const inserted = await db.insert(notificationSettings).values({}).returning();
  return inserted[0];
}

/** Format an instant as an ET deadline string for emails. */
function formatEtDeadline(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export interface AutoOfferOptions {
  /** Agent ids that already received an offer for this lead (reassignment). */
  excludeAgentIds?: number[];
}

export interface AutoOfferResult {
  ok: boolean;
  offerId?: number;
  agentId?: number;
  sent: boolean; // whether the email was sent now (vs queued for next window)
  reason?: string;
}

/**
 * Create and (if within the offer window) dispatch an offer for a lead.
 * Never throws on "no agent found" — logs a warning and alerts the admin.
 */
export async function autoOfferLead(
  leadId: number,
  opts: AutoOfferOptions = {},
): Promise<AutoOfferResult> {
  const leadRows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = leadRows[0];
  if (!lead) return { ok: false, sent: false, reason: 'lead-not-found' };

  const settings = await getSettings();
  const routingAgents = await getActiveRoutingAgents();

  // Use the persisted rotation (honors admin reorder; auto-rebuilds on roster
  // change) — §G.
  const queue = await getRoutingQueue(routingAgents);

  const result = recommendAgents({
    agents: routingAgents,
    propertyLat: lead.propertyLat,
    propertyLng: lead.propertyLng,
    radiusMiles: settings.proximityRadiusMiles ?? 20,
    queuePointer: queue.pointer,
    rotationList: queue.rotationList,
    excludedAgentIds: opts.excludeAgentIds ?? [],
  });

  if (result.agentId == null) {
    console.warn(`[autoOffer] No agent found for lead ${leadId}`);
    const msg = `No eligible agent was found for lead #${leadId}${
      lead.propertyAddress ? ` (${lead.propertyAddress})` : ''
    }. Please assign manually.`;
    await sendEmail(adminAlertEmail('Lead unrouted — no agent available', msg));
    return { ok: false, sent: false, reason: 'no-agent' };
  }

  // Persist the advanced queue pointer (Step 6) to agent_queue + keep the
  // settings pointer in sync for the admin Overview snapshot.
  await persistQueuePointer(result.newQueuePointer);
  await db
    .update(notificationSettings)
    .set({ queuePointer: result.newQueuePointer, updatedAt: new Date() })
    .where(eq(notificationSettings.id, settings.id));

  const now = new Date();
  const offerToken = crypto.randomBytes(32).toString('hex'); // 64-char hex
  const tokenExpiresAt = new Date(now.getTime() + OFFER_TOKEN_TTL_MS);

  const withinWindow = isWithinOfferWindow(
    now,
    settings.offerWindowStartHour ?? 7,
    settings.offerWindowEndHour ?? 20,
  );

  const inserted = await db
    .insert(leadOffers)
    .values({
      leadId,
      agentId: result.agentId,
      status: 'offered',
      offerToken,
      tokenExpiresAt,
      offerSentAt: null,
      distanceMiles: result.distanceMiles,
    })
    .returning({ id: leadOffers.id });
  const offerId = inserted[0].id;

  if (!withinWindow) {
    // Outside window: leave offerSentAt null; dispatch cron sends at next 7am.
    return { ok: true, offerId, agentId: result.agentId, sent: false, reason: 'queued-outside-window' };
  }

  // Within window — send now and set the timers.
  await dispatchOfferEmail(offerId);
  return { ok: true, offerId, agentId: result.agentId, sent: true };
}

/**
 * Send the offer email for an existing offer and set offerSentAt / firstUpdateDue /
 * nextReminderDue. Used both by autoOfferLead (within window) and the dispatch cron.
 * Refreshes the agent's magic link token (Section 13.2).
 */
export async function dispatchOfferEmail(offerId: number): Promise<boolean> {
  const rows = await db
    .select({
      offer: leadOffers,
      lead: leads,
      agent: agents,
    })
    .from(leadOffers)
    .innerJoin(leads, eq(leadOffers.leadId, leads.id))
    .innerJoin(agents, eq(leadOffers.agentId, agents.id))
    .where(eq(leadOffers.id, offerId))
    .limit(1);

  const row = rows[0];
  if (!row) return false;
  const { offer, lead, agent } = row;

  const now = new Date();
  const sentAt = now;
  const deadline = new Date(sentAt.getTime() + ACCEPTANCE_WINDOW_MS);

  // Refresh agent magic link token for the portal link.
  const token = generateMagicLinkToken();
  await db
    .update(agents)
    .set({ magicLinkToken: token, magicLinkExpiresAt: magicLinkExpiry(now), updatedAt: now })
    .where(eq(agents.id, agent.id));

  const base = siteUrl();
  const email = agentLeadOfferEmail({
    to: agent.email,
    agentName: `${agent.firstName} ${agent.lastName}`.trim(),
    leadFirstName: lead.firstName,
    leadCity: lead.propertyCity,
    leadType: lead.leadType,
    timeframe: lead.timeframe,
    valuationRange: formatRange(lead.priceRangeLow, lead.priceRangeHigh),
    deadlineEt: formatEtDeadline(deadline),
    acceptUrl: `${base}/api/offer/${offer.offerToken}?response=accept`,
    declineUrl: `${base}/api/offer/${offer.offerToken}?response=decline`,
    portalUrl: `${base}/agent/login?token=${token}`,
    relatedLeadId: lead.id,
    relatedAgentId: agent.id,
  });
  await sendEmail(email);

  // SMS alert (no-op unless Twilio is configured). Keep it short; the accept
  // link lets the agent claim the lead straight from their phone.
  try {
    const cityBit = lead.propertyCity ? ` in ${lead.propertyCity}` : '';
    await sendSms(
      agent.phone,
      `RE/MAX Platinum: new lead${cityBit}. Respond by ${formatEtDeadline(deadline)}. Accept: ${base}/api/offer/${offer.offerToken}?response=accept`,
    );
  } catch (err) {
    console.error('[autoOffer] offer SMS failed:', err);
  }

  await db
    .update(leadOffers)
    .set({
      offerSentAt: sentAt,
      firstUpdateDue: new Date(sentAt.getTime() + FIRST_UPDATE_MS),
      nextReminderDue: new Date(sentAt.getTime() + WEEKLY_MS),
      updatedAt: now,
    })
    .where(eq(leadOffers.id, offerId));

  await logLeadEvent(lead.id, 'offer_sent', `Offered to ${agent.firstName} ${agent.lastName}`.trim());

  return true;
}

/**
 * Reassign a lead to the next eligible agent, excluding everyone who already
 * received an offer for it. Called after a decline or auto-expiry.
 */
export async function reassignLead(leadId: number): Promise<AutoOfferResult> {
  const priorOffers = await db
    .select({ agentId: leadOffers.agentId })
    .from(leadOffers)
    .where(eq(leadOffers.leadId, leadId));
  const excludeAgentIds = Array.from(new Set(priorOffers.map((o) => o.agentId)));
  return autoOfferLead(leadId, { excludeAgentIds });
}

export interface ManualReassignResult {
  ok: boolean;
  newOfferId?: number;
  previousOfferClosed: boolean;
  reason?: string;
}

/**
 * Manually assign a lead to a chosen agent, bypassing the routing queue
 * (Section 18.3). Admin override — works regardless of the agent's
 * availability toggle.
 */
export async function manualReassignLead(
  leadId: number,
  newAgentId: number,
  _adminUserId?: string,
): Promise<ManualReassignResult> {
  const leadRows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = leadRows[0];
  if (!lead) return { ok: false, previousOfferClosed: false, reason: 'lead-not-found' };

  const agentRows = await db.select().from(agents).where(eq(agents.id, newAgentId)).limit(1);
  const agent = agentRows[0];
  if (!agent) return { ok: false, previousOfferClosed: false, reason: 'agent-not-found' };

  // No-op if the chosen agent already holds the lead (most recent accepted offer).
  const currentRows = await db
    .select({ id: leadOffers.id, agentId: leadOffers.agentId, status: leadOffers.status })
    .from(leadOffers)
    .where(eq(leadOffers.leadId, leadId));
  const accepted = currentRows.find((o) => o.status === 'accepted');
  if (accepted && accepted.agentId === newAgentId) {
    return { ok: false, previousOfferClosed: false, reason: 'already-assigned' };
  }

  const now = new Date();

  // 1. Close any outstanding (offered) offer so the prior agent can't accept it.
  let previousOfferClosed = false;
  const outstanding = currentRows.filter((o) => o.status === 'offered');
  for (const o of outstanding) {
    await db
      .update(leadOffers)
      .set({ status: 'closed_manual', respondedAt: now, updatedAt: now })
      .where(eq(leadOffers.id, o.id));
    previousOfferClosed = true;
  }
  // 2. No score penalty to the previous agent — this was an admin decision.

  // 3. Create a new offer already in the accepted state.
  const inserted = await db
    .insert(leadOffers)
    .values({
      leadId,
      agentId: newAgentId,
      status: 'accepted',
      offerToken: crypto.randomBytes(32).toString('hex'),
      tokenExpiresAt: new Date(now.getTime() + OFFER_TOKEN_TTL_MS),
      offerSentAt: now,
      acceptedAt: now,
      respondedAt: now,
      firstUpdateDue: new Date(now.getTime() + FIRST_UPDATE_MS),
      nextReminderDue: new Date(now.getTime() + WEEKLY_MS),
    })
    .returning({ id: leadOffers.id });
  const newOfferId = inserted[0].id;

  // 4. Reflect new assignment on the lead.
  await db
    .update(leads)
    .set({ acceptedAt: now, lastStatusChangedAt: now, updatedAt: now })
    .where(eq(leads.id, leadId));

  await logLeadEvent(leadId, 'manually_assigned', `Assigned to ${agent.firstName} ${agent.lastName}`.trim());

  // 5. Notify the new agent it was a direct admin assignment (full lead info).
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
      adminAssigned: true,
      relatedLeadId: lead.id,
      relatedAgentId: agent.id,
    }),
  );
  try {
    const cityBit = lead.propertyCity ? ` in ${lead.propertyCity}` : '';
    await sendSms(
      agent.phone,
      `RE/MAX Platinum: you've been assigned a lead${cityBit}. Details in the agent portal: ${siteUrl()}/agent/leads`,
    );
  } catch (err) {
    console.error('[autoOffer] assignment SMS failed:', err);
  }

  return { ok: true, newOfferId, previousOfferClosed };
}

/** Helper for cron: find queued offers (offerSentAt null, status offered). */
export async function findQueuedOfferIds(): Promise<number[]> {
  const rows = await db
    .select({ id: leadOffers.id })
    .from(leadOffers)
    .where(and(eq(leadOffers.status, 'offered'), isNull(leadOffers.offerSentAt)));
  return rows.map((r) => r.id);
}

export { inArray };
