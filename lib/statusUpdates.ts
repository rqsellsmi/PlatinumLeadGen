/**
 * Shared agent status-update domain logic — Scoring v4 (Seller Track).
 * See docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md.
 *
 * One entry point for the agent portal, the status-update API, and the SMS
 * webhook. Validates the transition against the v4 flow, awards once-only
 * milestone points + the fast-engagement bonus, resets the unified update
 * clock, records backward moves (no points), and enforces origin-scoped Lost
 * reasons.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { leadOffers, leads, statusUpdates } from '../drizzle/schema';
import { applyScore, claimLeadMilestone, fastEngagementDelta } from './scoring';
import { logLeadEvent } from './leadEvents';
import {
  AGENT_SETTABLE_STATUSES_V4,
  isValidTransition,
  isBackwardMove,
  isValidLostReasonForOrigin,
  v4LostReasonLabel,
} from './leadLifecycle';

export const AGENT_SETTABLE_STATUSES = AGENT_SETTABLE_STATUSES_V4;
export type AgentSettableStatus = (typeof AGENT_SETTABLE_STATUSES_V4)[number];

export type RecordStatusResult = {
  ok: boolean;
  reason?: 'invalid-status' | 'invalid-transition' | 'offer-not-found' | 'lost-reason-required';
  /** True when this move was a backward reactivation to Nurturing (no points). */
  backward?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SIGNED_WINDOW_MS = 14 * DAY_MS;

/** The v4 update-clock deadline for a status the lead just moved to (§5). */
function nextUpdateDeadline(status: string, now: Date): Date | null {
  if (status === 'closed' || status === 'lost') return null; // clock stops
  if (status === 'signed') return new Date(now.getTime() + SIGNED_WINDOW_MS);
  return new Date(now.getTime() + WEEK_MS); // everything else incl. backward-to-nurturing
}

export async function recordStatusUpdate(o: {
  agentId: number;
  leadOfferId: number;
  newStatus: string;
  note?: string | null;
  lostReason?: string | null;
}): Promise<RecordStatusResult> {
  if (!(AGENT_SETTABLE_STATUSES_V4 as readonly string[]).includes(o.newStatus)) {
    return { ok: false, reason: 'invalid-status' };
  }
  const newStatus = o.newStatus as AgentSettableStatus;

  const offerRows = await db
    .select()
    .from(leadOffers)
    .where(and(eq(leadOffers.id, o.leadOfferId), eq(leadOffers.agentId, o.agentId)))
    .limit(1);
  const offer = offerRows[0];
  if (!offer || offer.status !== 'accepted') {
    return { ok: false, reason: 'offer-not-found' };
  }

  const leadRows = await db
    .select({ status: leads.status, acceptedAt: leads.acceptedAt, contactedAt: leads.contactedAt })
    .from(leads)
    .where(eq(leads.id, offer.leadId))
    .limit(1);
  const leadRow = leadRows[0];
  const fromStatus = leadRow?.status ?? 'new';

  // The move must be legal in the v4 flow (§3).
  if (!isValidTransition(fromStatus, newStatus)) {
    return { ok: false, reason: 'invalid-transition' };
  }

  // Lost is reason-gated by the origin status (§6); Lost A2 needs ≥6 attempts.
  if (newStatus === 'lost') {
    let attemptedCount = 0;
    const attemptedRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(statusUpdates)
      .where(
        and(eq(statusUpdates.leadId, offer.leadId), eq(statusUpdates.newStatus, 'attempted_contact')),
      );
    attemptedCount = Number(attemptedRows[0]?.n ?? 0);
    if (!isValidLostReasonForOrigin(fromStatus, o.lostReason, attemptedCount)) {
      return { ok: false, reason: 'lost-reason-required' };
    }
  }

  const now = new Date();
  const backward = isBackwardMove(fromStatus, newStatus);

  await db.insert(statusUpdates).values({
    leadOfferId: offer.id,
    leadId: offer.leadId,
    agentId: o.agentId,
    newStatus,
    note: o.note ?? null,
  });

  // Lead row: status, stall/clock reference, unified update deadline (§5), and
  // Connected/Lost bookkeeping.
  const leadUpdate: Record<string, unknown> = {
    status: newStatus,
    lastStatusChangedAt: now,
    updateDeadline: nextUpdateDeadline(newStatus, now),
    updatedAt: now,
  };
  if (newStatus === 'connected' && !leadRow?.contactedAt) leadUpdate.contactedAt = now;
  if (newStatus === 'lost') {
    leadUpdate.lostReason = o.lostReason;
    leadUpdate.lostAt = now;
  }
  await db.update(leads).set(leadUpdate).where(eq(leads.id, offer.leadId));

  // First-update stamp drives the 48h escalation email (kept in v4, §7).
  if (offer.firstUpdateSubmittedAt == null) {
    await db
      .update(leadOffers)
      .set({ firstUpdateSubmittedAt: now, updatedAt: now })
      .where(eq(leadOffers.id, offer.id));
  }

  // Timeline.
  await logLeadEvent(
    offer.leadId,
    newStatus === 'lost' ? 'marked_lost' : 'status_updated',
    newStatus === 'lost'
      ? `Lost — ${v4LostReasonLabel(o.lostReason ?? '')}${o.note ? ` · ${o.note}` : ''}`
      : backward
        ? `Reactivated to Nurturing (from ${fromStatus})${o.note ? ` · ${o.note}` : ''}`
        : o.note
          ? `${newStatus} — ${o.note}`
          : newStatus,
  );

  // ===== Scoring (v4) =====
  const acceptedAt = leadRow?.acceptedAt ?? offer.acceptedAt ?? null;
  try {
    // Fast-engagement bonus — once per lead, on the first Attempted/Connected log,
    // measured from accept (§4.2). Atomic claim so it never double-fires.
    if (newStatus === 'attempted_contact' || newStatus === 'connected') {
      const claimedEngagement = await db
        .update(leads)
        .set({ firstEngagementLogged: true, updatedAt: now })
        .where(and(eq(leads.id, offer.leadId), eq(leads.firstEngagementLogged, false)))
        .returning({ id: leads.id });
      if (claimedEngagement.length > 0 && acceptedAt) {
        const bonus = fastEngagementDelta(now.getTime() - acceptedAt.getTime());
        if (bonus > 0) {
          await applyScore({
            agentId: o.agentId,
            reason: 'fast_engagement',
            delta: bonus,
            leadId: offer.leadId,
            leadOfferId: offer.id,
          });
        }
      }
    }

    // Status milestones — once per lead (§4.3). Backward moves pay nothing (D3).
    if (!backward) {
      if (newStatus === 'attempted_contact') {
        if (await claimLeadMilestone(offer.leadId, 'attempted_contact', now)) {
          await applyScore({ agentId: o.agentId, reason: 'pipeline_attempted', leadId: offer.leadId, leadOfferId: offer.id });
        }
      } else if (newStatus === 'connected') {
        if (await claimLeadMilestone(offer.leadId, 'connected', now)) {
          await applyScore({ agentId: o.agentId, reason: 'pipeline_contacted', leadId: offer.leadId, leadOfferId: offer.id });
        }
      } else if (newStatus === 'appointment_set') {
        if (await claimLeadMilestone(offer.leadId, 'appointment_set', now)) {
          await applyScore({ agentId: o.agentId, reason: 'milestone_appointment_set', leadId: offer.leadId, leadOfferId: offer.id });
        }
      } else if (newStatus === 'signed') {
        if (await claimLeadMilestone(offer.leadId, 'signed', now)) {
          await applyScore({ agentId: o.agentId, reason: 'milestone_signed', leadId: offer.leadId, leadOfferId: offer.id });
        }
      } else if (newStatus === 'closed') {
        // Closed Won is terminal (reached once); +25.
        await applyScore({ agentId: o.agentId, reason: 'system_closing', leadId: offer.leadId, leadOfferId: offer.id });
      }
      // nurturing / lost → 0 points.
    }
  } catch (err) {
    console.error('[lib/statusUpdates] scoring failed:', err);
  }

  return { ok: true, backward };
}
