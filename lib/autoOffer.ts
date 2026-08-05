/**
 * autoOfferLead() and reassignLead() (Section 5.5).
 * Called from /api/leads/submit and /api/webhooks/lead after a lead is saved.
 */
import { siteUrl } from './siteUrl';
import crypto from 'crypto';
import { eq, inArray, and, isNull, isNotNull } from 'drizzle-orm';
import { db } from './db';
import {
  leads,
  agents,
  offices,
  leadOffers,
  notificationSettings,
} from '../drizzle/schema';
import { recommendAgents, type RoutingAgent } from './routing';
import { getRoutingQueue, persistQueue } from './queue';
import { isWithinOfferWindow } from './offerWindow';
import { sendEmail, agentLeadOfferEmail, agentAcceptanceEmail, adminAlertEmail, leadOutsideAreaEmail } from './email';
import { sendAgentSms } from './agentSms';
import { sendClientInfoSms } from './clientInfoSms';
import { offerText } from './smsTemplates';
import { issueMagicLinkToken } from './agentMagicLink';
import { logLeadEvent } from './leadEvents';
import { decideCoverage, deriveCityFromAddress } from './coverage';

/** Format a price range for emails, e.g. "$398K–$442K". */
function formatRange(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null;
  const k = (n: number | null) => (n == null ? '?' : `$${Math.round(n / 1000)}K`);
  return `${k(low)}–${k(high)}`;
}

const OFFER_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCEPTANCE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3-hour acceptance timer
const FIRST_UPDATE_MS = 48 * 60 * 60 * 1000; // 48 hours
const INITIAL_UPDATE_DEADLINE_MS = 24 * 60 * 60 * 1000; // v4 §5 — 24h to first engagement
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Load the queue's MEMBERS with their effective proximity anchor: the agent's
 * geocoded custom location when they chose 'custom' (and it geocoded), otherwise
 * their office coordinates. Also carries each agent's own acceptance radius
 * (null → global default applied in routing).
 *
 * MEMBERSHIP vs AVAILABILITY (D7). This used to filter on
 * `isAvailable = true`, which made availability a membership filter: pausing
 * deleted every one of an agent's slots from the persisted rotation, and
 * resuming re-wove them into the middle — so a pause/resume cycle acted as a
 * queue reset and could be used to jump the line.
 *
 * Membership is now "active AND has opted in at least once" (`queueJoinedAt`),
 * and it survives pauses. `isAvailable` rides along on each RoutingAgent so
 * `recommendAgents` can apply it as a SEND-TIME skip instead. An agent who has
 * never opted in is not a member at all, so they are never added to the queue.
 */
export async function getActiveRoutingAgents(): Promise<RoutingAgent[]> {
  const rows = await db
    .select({
      id: agents.id,
      anchor: agents.proximityAnchor,
      lat: agents.latitude,
      lng: agents.longitude,
      radius: agents.proximityRadiusMiles,
      // Routing slots are driven by the rolling-365 track (spec v2 §3).
      score: agents.scoreRolling365,
      isAvailable: agents.isAvailable,
      joinedAt: agents.queueJoinedAt,
      officeLat: offices.latitude,
      officeLng: offices.longitude,
    })
    .from(agents)
    .leftJoin(offices, eq(agents.officeId, offices.id))
    .where(and(eq(agents.isActive, true), isNotNull(agents.queueJoinedAt)));

  return rows.map((r) => {
    const useCustom = r.anchor === 'custom' && r.lat != null && r.lng != null;
    return {
      id: r.id,
      lat: useCustom ? r.lat : r.officeLat ?? null,
      lng: useCustom ? r.lng : r.officeLng ?? null,
      score: r.score ?? 0,
      radiusMiles: r.radius ?? null,
      isAvailable: r.isAvailable,
      joinedAtMs: r.joinedAt?.getTime() ?? null,
    };
  });
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

  // Prod smoke-test leads never reach an agent (D20/D23 MODIFIED).
  if (lead.isTest) {
    console.info(`[autoOffer] Lead ${leadId} is flagged is_test — not routed`);
    return { ok: false, sent: false, reason: 'test-lead' };
  }

  // ----- Out-of-state gate (D22 / #76) ------------------------------------
  // A 250-mile radius from parts of Michigan reaches Ohio, Indiana, Illinois
  // and Ontario, so the radius alone cannot keep a Michigan brokerage's queue
  // in Michigan. A full lead on an out-of-state property is never auto-assigned
  // — even when an agent's circle covers it — and goes to the admin instead.
  //
  // An UNKNOWN state routes normally. leads.propertyState is NULL for every
  // organically-submitted lead today (the public forms post only the formatted
  // address and coordinates), so treating "no state" as "out of state" would
  // send the entire funnel to the admin. Same distinction the outside-area rule
  // already makes between "outside the area" and "we can't tell where it is".
  const coverage = decideCoverage({
    propertyState: lead.propertyState,
    propertyAddress: lead.propertyAddress,
  });
  if (coverage.kind === 'out_of_state') {
    console.warn(
      `[autoOffer] Lead ${leadId} is out of state (${coverage.state}) — routed to the admin`,
    );
    const leadName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'New lead';
    await sendEmail(
      leadOutsideAreaEmail({
        leadName,
        leadEmail: lead.email,
        leadPhone: lead.phone,
        propertyAddress: lead.propertyAddress,
        propertyCity: lead.propertyCity,
        estimatedValue: lead.estimatedValue,
        nearestAgentMiles: null,
        adminLeadUrl: `${siteUrl()}/admin/leads/${leadId}`,
        relatedLeadId: leadId,
      }),
    );
    return { ok: false, sent: false, reason: 'out-of-state' };
  }

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
    rotationList: queue.rotationList,
    excludedAgentIds: opts.excludeAgentIds ?? [],
  });

  if (result.agentId == null) {
    // Lead is outside every geocoded agent's service area — deliberately leave it
    // UNASSIGNED (no global fallback) and notify the admin with the details so
    // they can handle it directly (owner decision).
    if (result.outcome === 'outside-area') {
      console.warn(`[autoOffer] Lead ${leadId} is outside every active agent's area — left unassigned`);
      const leadName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'New lead';
      await sendEmail(
        leadOutsideAreaEmail({
          leadName,
          leadEmail: lead.email,
          leadPhone: lead.phone,
          propertyAddress: lead.propertyAddress,
          propertyCity: lead.propertyCity,
          estimatedValue: lead.estimatedValue,
          nearestAgentMiles: result.distanceMiles,
          adminLeadUrl: `${siteUrl()}/admin/leads/${leadId}`,
          relatedLeadId: leadId,
        }),
      );
      return { ok: false, sent: false, reason: 'outside-area' };
    }

    console.warn(`[autoOffer] No agent found for lead ${leadId}`);
    const msg = `No eligible agent was found for lead #${leadId}${
      lead.propertyAddress ? ` (${lead.propertyAddress})` : ''
    }. Please assign manually.`;
    await sendEmail(adminAlertEmail('Lead unrouted — no agent available', msg));
    return { ok: false, sent: false, reason: 'no-agent' };
  }

  // Persist the mutated queue (served slot moved to the back; distance-skipped
  // slots kept at the front) to agent_queue. Pointer is vestigial (front = next).
  await persistQueue(result.rotationList);
  await db
    .update(notificationSettings)
    .set({ queuePointer: 0, updatedAt: new Date() })
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

  // P0.8a / D6: mint a fresh magic-link token stored only as a SHA-256 hash and
  // email the raw value. We no longer read or persist a plaintext token here —
  // the offer email is the primary login channel, so writing cleartext to
  // `magic_link_token` (as this did) re-introduced the exact exposure hashing
  // was meant to close. Each outbound message supersedes the previous link; an
  // expired/superseded link lands on the request-a-new-link page (D6).
  const token = await issueMagicLinkToken(agent.id);

  // WHAT AN UNACCEPTED OFFER MAY SAY: first name, city, estimate, timeframe,
  // deadline. Never a phone number, an email address, or a street address — the
  // agent has not taken the lead yet, so the offer must not let anyone contact
  // the seller or find their house. Everything else goes out on accept
  // (clientInfoText / agentAcceptanceEmail).
  //
  // City comes from Places on new leads (P0.4); derive it from the formatted
  // address for legacy, webhook and admin-created leads, which may only have
  // that. deriveCityFromAddress returns null rather than guessing, and refuses
  // any candidate containing a digit, so a house number cannot leak through it.
  const offerCity = lead.propertyCity?.trim() || deriveCityFromAddress(lead.propertyAddress);

  const base = siteUrl();
  const email = agentLeadOfferEmail({
    to: agent.email,
    agentName: `${agent.firstName} ${agent.lastName}`.trim(),
    leadFirstName: lead.firstName,
    leadCity: offerCity,
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

  // SMS alert (no-op unless Telnyx is configured). Keep it short; the agent
  // can claim the lead straight from their phone by replying YES <id>.
  try {
    await sendAgentSms({
      agent,
      kind: 'offer',
      leadId: lead.id,
      body: offerText({
        leadId: lead.id,
        firstName: lead.firstName ?? null,
        city: offerCity,
        estimate: lead.estimatedValue ?? null,
        timeframe: lead.timeframe ?? null,
        deadline: formatEtDeadline(deadline),
      }),
    });
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

  // 4. Reflect new assignment on the lead (start the v4 24h update clock).
  await db
    .update(leads)
    .set({
      acceptedAt: now,
      lastStatusChangedAt: now,
      updateDeadline: new Date(now.getTime() + INITIAL_UPDATE_DEADLINE_MS),
      firstEngagementLogged: false,
      updatedAt: now,
    })
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
  await sendClientInfoSms(lead.id, agent.id, newOfferId);

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
