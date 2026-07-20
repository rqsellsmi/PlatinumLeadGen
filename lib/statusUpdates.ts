/**
 * Shared agent status-update domain logic (Section 9). Extracted from the
 * portal route (app/api/agent/status-update/route.ts) so the SMS webhook can
 * reuse the exact same behavior. Validates the request, loads the offer,
 * enforces the Lost precondition, inserts a status_updates row, updates the
 * lead's lifecycle timestamps, logs the event, marks firstUpdateSubmittedAt,
 * and applies pipeline scoring.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { leadOffers, leads, statusUpdates } from '../drizzle/schema';
import { applyScore } from './scoring';
import { logLeadEvent } from './leadEvents';
import { isLostReason, canMarkLost } from './leadLifecycle';

// Agents move a lead through these; 'reopened' is set by intake, never here.
export const AGENT_SETTABLE_STATUSES = [
  'new',
  'attempted_contact',
  'contacted',
  'qualified',
  'working',
  'closed',
  'lost',
] as const;
export type AgentSettableStatus = (typeof AGENT_SETTABLE_STATUSES)[number];

export type RecordStatusResult = {
  ok: boolean;
  reason?: 'invalid-status' | 'offer-not-found' | 'lost-gated' | 'lost-reason-required';
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function recordStatusUpdate(o: {
  agentId: number;
  leadOfferId: number;
  newStatus: string;
  note?: string | null;
  lostReason?: string | null;
}): Promise<RecordStatusResult> {
  if (!AGENT_SETTABLE_STATUSES.includes(o.newStatus as AgentSettableStatus)) {
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
    .select({ acceptedAt: leads.acceptedAt, contactedAt: leads.contactedAt })
    .from(leads)
    .where(eq(leads.id, offer.leadId))
    .limit(1);
  const leadRow = leadRows[0];

  // Lost precondition (spec v2 §4.2): a lead can only be marked Lost after it
  // has been Contacted, OR after enough genuine Attempted-Contact updates
  // (agent tried repeatedly but never reached the seller). Requires a reason.
  if (newStatus === 'lost') {
    let attemptedCount = 0;
    if (!leadRow?.contactedAt) {
      const attemptedRows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(statusUpdates)
        .where(
          and(
            eq(statusUpdates.leadId, offer.leadId),
            eq(statusUpdates.newStatus, 'attempted_contact'),
          ),
        );
      attemptedCount = Number(attemptedRows[0]?.n ?? 0);
    }
    if (!canMarkLost({ contactedAt: leadRow?.contactedAt, attemptedContactCount: attemptedCount })) {
      return { ok: false, reason: 'lost-gated' };
    }
    if (!isLostReason(o.lostReason)) {
      return { ok: false, reason: 'lost-reason-required' };
    }
  }

  const now = new Date();

  await db.insert(statusUpdates).values({
    leadOfferId: offer.id,
    leadId: offer.leadId,
    agentId: o.agentId,
    newStatus,
    note: o.note ?? null,
  });

  // Lifecycle timestamps: stamp contactedAt on first Contacted; record the Lost
  // reason/time. lastStatusChangedAt is the stall-clock reference.
  const leadUpdate: Record<string, unknown> = {
    status: newStatus,
    lastStatusChangedAt: now,
    updatedAt: now,
  };
  if (newStatus === 'contacted' && !leadRow?.contactedAt) leadUpdate.contactedAt = now;
  if (newStatus === 'lost') {
    leadUpdate.lostReason = o.lostReason;
    leadUpdate.lostAt = now;
  }
  await db.update(leads).set(leadUpdate).where(eq(leads.id, offer.leadId));

  await logLeadEvent(
    offer.leadId,
    newStatus === 'lost' ? 'marked_lost' : 'status_updated',
    newStatus === 'lost'
      ? `Lost — ${o.lostReason}${o.note ? ` · ${o.note}` : ''}`
      : o.note
        ? `${newStatus} — ${o.note}`
        : newStatus,
  );

  // Mark first update if this is the agent's first one for this offer.
  const isFirstUpdate = offer.firstUpdateSubmittedAt == null;
  if (isFirstUpdate) {
    await db
      .update(leadOffers)
      .set({ firstUpdateSubmittedAt: now, updatedAt: now })
      .where(eq(leadOffers.id, offer.id));
  }

  // Pipeline scoring.
  const acceptedAt = leadRow?.acceptedAt ?? offer.acceptedAt ?? null;

  try {
    if (newStatus === 'attempted_contact') {
      await applyScore({
        agentId: o.agentId,
        reason: 'pipeline_attempted',
        leadId: offer.leadId,
        leadOfferId: offer.id,
      });
    } else if (newStatus === 'contacted') {
      await applyScore({
        agentId: o.agentId,
        reason: 'pipeline_contacted',
        leadId: offer.leadId,
        leadOfferId: offer.id,
      });
      if (acceptedAt && now.getTime() - acceptedAt.getTime() <= DAY_MS) {
        await applyScore({
          agentId: o.agentId,
          reason: 'fast_contact_bonus',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });
      }
    } else if (newStatus === 'qualified') {
      await applyScore({
        agentId: o.agentId,
        reason: 'pipeline_qualified',
        leadId: offer.leadId,
        leadOfferId: offer.id,
      });
    } else if (newStatus === 'closed') {
      await applyScore({
        agentId: o.agentId,
        reason: 'system_closing',
        leadId: offer.leadId,
        leadOfferId: offer.id,
      });
    }
  } catch (err) {
    console.error('[lib/statusUpdates] applyScore failed:', err);
  }

  return { ok: true };
}
