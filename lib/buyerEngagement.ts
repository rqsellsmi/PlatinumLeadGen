/**
 * Buyer lead-on-engagement (migration 0037/0038).
 *
 * A buyer account is NOT a lead until it takes a lead-creating action — saving a
 * home, saving a search, requesting a showing/contact, or claiming a valuation.
 * `onFirstEngagement` is the single entry every one of those paths calls. It:
 *
 *   1. attaches to a lead already linked to this buyer, or to an existing active
 *      buyer/seller lead with the same email (dedup, D6) — and notifies its
 *      assigned agent; no new lead, no re-route.
 *   2. otherwise branches on the buyer's representation answer (Phase 5):
 *        none            → create a buyer lead + auto-offer (referral eligible)
 *        our_agent       → create + direct-assign to the claimed agent, and hold
 *                          the lead's points (referral pending_review) for admin
 *        other_brokerage → create NO lead; mark the buyer represented elsewhere.
 *
 * The routing anchor is the engagement location (the listing's coords, or the
 * saved search's centroid).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { agents, buyerUsers, leadOffers, leads, type Lead } from '../drizzle/schema';
import { getListingByKey } from './idx';
import { autoOfferLead, manualReassignLead } from './autoOffer';
import { logLeadEvent } from './leadEvents';
import { sendEmail, buyerEngagementEmail, adminAlertEmail } from './email';
import { siteUrl } from './siteUrl';

/** Statuses that mean a lead is finished (a fresh engagement starts a new one). */
const CLOSED_STATUSES = ['closed', 'lost'] as const;

export type RepresentationInput =
  | { kind: 'none' }
  | { kind: 'our_agent'; claimedAgentId?: number | null; claimedAgentName?: string | null }
  | { kind: 'other_brokerage' };

export type EngagementKind = 'favorite' | 'saved_search' | 'showing' | 'contact' | 'valuation';

export interface EngagementInput {
  buyerUserId: number;
  kind: EngagementKind;
  /** For favorite/showing/contact: the listing engaged. */
  listingKey?: string | null;
  /** For saved_search: the search label + its routing centroid. */
  savedSearch?: { name: string; lat: number | null; lng: number | null } | null;
  /** For valuation: the buyer's own home (potential-seller signal), the anchor. */
  home?: { address: string; lat: number | null; lng: number | null } | null;
  /** The representation answer, gathered once at the first lead-creating action. */
  representation?: RepresentationInput;
}

/** Parse a representation answer from an API body into a typed input (or undefined). */
export function parseRepresentation(raw: unknown): RepresentationInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'none':
      return { kind: 'none' };
    case 'other_brokerage':
      return { kind: 'other_brokerage' };
    case 'our_agent':
      return {
        kind: 'our_agent',
        claimedAgentId: typeof r.claimedAgentId === 'number' ? r.claimedAgentId : null,
        claimedAgentName:
          typeof r.claimedAgentName === 'string' && r.claimedAgentName.trim()
            ? r.claimedAgentName.trim().slice(0, 200)
            : null,
      };
    default:
      return undefined;
  }
}

export type EngagementDecision = 'attach' | 'route' | 'assign-claimed' | 'suppress';

export interface EngagementResult {
  ok: boolean;
  reason?: 'buyer-not-found';
  decision?: EngagementDecision;
  leadId?: number;
  created?: boolean;
}

/**
 * Pure decision: given the existing active lead (if any) and the representation
 * answer, what should the engagement do? Separated from all I/O so the matrix is
 * unit-tested directly.
 */
export function decideEngagement(
  existingLead: { id: number } | null | undefined,
  representation: RepresentationInput | undefined,
): EngagementDecision {
  if (existingLead) return 'attach';
  switch (representation?.kind) {
    case 'other_brokerage':
      return 'suppress';
    case 'our_agent':
      return 'assign-claimed';
    default:
      return 'route';
  }
}

/**
 * Whether the representation question should be asked before this buyer's next
 * lead-creating action. Ask only when the action would create a NEW lead: skip
 * if the buyer already has an active lead (we attach) or already declared they
 * are represented elsewhere (we suppress) — neither needs re-prompting.
 */
export async function needsRepresentationAnswer(buyerUserId: number): Promise<boolean> {
  const rows = await db
    .select({ email: buyerUsers.email, represented: buyerUsers.representedElsewhere })
    .from(buyerUsers)
    .where(and(eq(buyerUsers.id, buyerUserId), sql`${buyerUsers.deletedAt} IS NULL`))
    .limit(1);
  const buyer = rows[0];
  if (!buyer) return false;
  if (buyer.represented) return false;
  const existing = await findExistingLeadForBuyer(buyerUserId, buyer.email);
  return existing == null;
}

/** The most recent active lead already tied to this buyer, or matching its email. */
async function findExistingLeadForBuyer(buyerUserId: number, email: string | null): Promise<Lead | null> {
  const emailMatch = email
    ? sql`lower(${leads.email}) = ${email.toLowerCase()}`
    : sql`false`;
  const rows = await db
    .select()
    .from(leads)
    .where(
      and(
        sql`(${leads.buyerUserId} = ${buyerUserId} OR ${emailMatch})`,
        eq(leads.isDeleted, false),
        sql`${leads.status} NOT IN ('closed','lost')`,
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** The agent currently assigned to a lead (via its accepted offer), or null. */
async function findAssignedAgent(leadId: number): Promise<{ id: number; email: string; name: string } | null> {
  const rows = await db
    .select({ id: agents.id, email: agents.email, first: agents.firstName, last: agents.lastName })
    .from(leadOffers)
    .innerJoin(agents, eq(leadOffers.agentId, agents.id))
    .where(and(eq(leadOffers.leadId, leadId), eq(leadOffers.status, 'accepted')))
    .limit(1);
  const r = rows[0];
  return r ? { id: r.id, email: r.email, name: `${r.first} ${r.last}`.trim() } : null;
}

interface EngagementContext {
  label: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

async function resolveContext(input: EngagementInput): Promise<EngagementContext> {
  if (input.listingKey) {
    const listing = await getListingByKey(input.listingKey);
    if (listing) {
      const addr = [listing.address, listing.city].filter(Boolean).join(', ') || listing.city || input.listingKey;
      return {
        label: `${engagementVerb(input.kind)} ${addr}`,
        lat: listing.latitude ?? null,
        lng: listing.longitude ?? null,
        address: listing.address ?? null,
        city: listing.city ?? null,
        state: listing.stateOrProvince ?? null,
      };
    }
  }
  if (input.savedSearch) {
    return {
      label: `${engagementVerb(input.kind)} “${input.savedSearch.name}”`,
      lat: input.savedSearch.lat,
      lng: input.savedSearch.lng,
      address: null,
      city: null,
      state: null,
    };
  }
  if (input.home) {
    return {
      label: `${engagementVerb(input.kind)} (${input.home.address})`,
      lat: input.home.lat,
      lng: input.home.lng,
      address: input.home.address,
      city: null,
      state: null,
    };
  }
  return { label: engagementVerb(input.kind), lat: null, lng: null, address: null, city: null, state: null };
}

function engagementVerb(kind: EngagementKind): string {
  switch (kind) {
    case 'favorite':
      return 'saved a home';
    case 'saved_search':
      return 'saved a search';
    case 'showing':
      return 'requested a showing on';
    case 'contact':
      return 'asked to be contacted about';
    case 'valuation':
      return 'requested a home valuation';
  }
}

export async function onFirstEngagement(input: EngagementInput): Promise<EngagementResult> {
  const buyerRows = await db
    .select()
    .from(buyerUsers)
    .where(and(eq(buyerUsers.id, input.buyerUserId), sql`${buyerUsers.deletedAt} IS NULL`))
    .limit(1);
  const buyer = buyerRows[0];
  if (!buyer) return { ok: false, reason: 'buyer-not-found' };

  // A buyer who previously declared "represented elsewhere" keeps suppressing
  // future leads even without re-answering.
  const representation: RepresentationInput | undefined =
    input.representation ?? (buyer.representedElsewhere ? { kind: 'other_brokerage' } : undefined);

  const existing = await findExistingLeadForBuyer(buyer.id, buyer.email);
  const decision = decideEngagement(existing, representation);
  const ctx = await resolveContext(input);
  const [firstName, ...rest] = (buyer.name ?? '').trim().split(/\s+/).filter(Boolean);
  const lastName = rest.join(' ') || null;

  // --- attach: link to the existing lead + notify its assigned agent ----------
  if (decision === 'attach' && existing) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (existing.buyerUserId == null) patch.buyerUserId = buyer.id;
    if (input.listingKey) patch.interestedListingKey = input.listingKey;
    await db.update(leads).set(patch).where(eq(leads.id, existing.id));
    await logLeadEvent(existing.id, existing.buyerUserId == null ? 'lead_linked' : 'buyer_engaged', ctx.label);

    const agent = await findAssignedAgent(existing.id);
    if (agent) {
      try {
        await sendEmail(
          buyerEngagementEmail({
            to: agent.email,
            agentName: agent.name,
            buyerName: buyer.name || buyer.email,
            buyerEmail: buyer.email,
            action: engagementVerb(input.kind),
            detail: ctx.address ?? ctx.label,
            portalUrl: `${siteUrl()}/agent/leads`,
            relatedLeadId: existing.id,
            relatedAgentId: agent.id,
          }),
        );
      } catch (err) {
        console.error('[buyerEngagement] attach notify failed:', err);
      }
    }
    return { ok: true, decision, leadId: existing.id, created: false };
  }

  // --- suppress: represented elsewhere → no lead ------------------------------
  if (decision === 'suppress') {
    await db
      .update(buyerUsers)
      .set({ representedElsewhere: true, lastSeenAt: new Date() })
      .where(eq(buyerUsers.id, buyer.id));
    return { ok: true, decision };
  }

  // --- route / assign-claimed: create a buyer lead ----------------------------
  const claimed =
    representation?.kind === 'our_agent'
      ? representation
      : { claimedAgentId: null as number | null, claimedAgentName: null as string | null };
  const isClaimed = decision === 'assign-claimed';

  const inserted = await db
    .insert(leads)
    .values({
      leadType: 'buyer_inquiry',
      intent: 'buyer',
      status: 'new',
      firstName: firstName ?? null,
      lastName,
      email: buyer.email,
      phone: buyer.phone ?? null,
      propertyAddress: ctx.address,
      propertyCity: ctx.city,
      propertyState: ctx.state,
      propertyLat: ctx.lat,
      propertyLng: ctx.lng,
      interestedListingKey: input.listingKey ?? null,
      buyerUserId: buyer.id,
      source: 'buyer_account',
      representation: isClaimed ? 'our_agent' : 'none',
      claimedAgentId: isClaimed ? claimed.claimedAgentId ?? null : null,
      claimedAgentName: isClaimed ? claimed.claimedAgentName ?? null : null,
      // A claimed-our-agent lead is held for admin referral review; all others
      // are referral-eligible by default (site-generated → 30% referral owed).
      referralStatus: isClaimed ? 'pending_review' : 'eligible',
    })
    .returning({ id: leads.id });
  const leadId = inserted[0].id;
  await logLeadEvent(leadId, 'buyer_engaged', ctx.label);

  if (isClaimed) {
    await logLeadEvent(
      leadId,
      'referral_pending',
      `Buyer says they work with ${claimed.claimedAgentName ?? 'one of our agents'} — points held for admin review`,
    );
    if (claimed.claimedAgentId) {
      // Direct-assign straight to the claimed agent (no queue offer).
      try {
        await manualReassignLead(leadId, claimed.claimedAgentId);
      } catch (err) {
        console.error('[buyerEngagement] claimed direct-assign failed:', err);
      }
    } else {
      // Claimed an agent we couldn't match by picker — leave unassigned and let
      // an admin route + adjudicate rather than auto-routing to the wrong agent.
      try {
        await sendEmail(
          adminAlertEmail(
            'Buyer claims a RE/MAX Platinum agent',
            `${buyer.name || buyer.email} says they work with "${claimed.claimedAgentName ?? 'an agent'}" ` +
              `but no agent was selected. Lead #${leadId} is held for referral review and needs manual assignment.`,
          ),
        );
      } catch (err) {
        console.error('[buyerEngagement] claimed admin alert failed:', err);
      }
    }
    return { ok: true, decision, leadId, created: true };
  }

  // route: proximity auto-offer through the existing pipeline.
  try {
    await autoOfferLead(leadId);
  } catch (err) {
    console.error('[buyerEngagement] autoOffer failed:', err);
  }
  return { ok: true, decision, leadId, created: true };
}
