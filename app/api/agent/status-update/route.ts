/**
 * POST /api/agent/status-update — agent submits a pipeline status update. (Section 9)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, statusUpdates } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { applyScore } from '@/lib/scoring';
import { logLeadEvent } from '@/lib/leadEvents';
import { isLostReason, canMarkLost } from '@/lib/leadLifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Agents move a lead through these; 'reopened' is set by intake, never here.
const VALID_STATUSES = [
  'new',
  'attempted_contact',
  'contacted',
  'qualified',
  'working',
  'closed',
  'lost',
] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const agent = await getCurrentAgent();
    if (!agent) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { leadOfferId?: number; newStatus?: string; note?: string; lostReason?: string }
      | null;
    if (
      !body ||
      typeof body.leadOfferId !== 'number' ||
      typeof body.newStatus !== 'string' ||
      !VALID_STATUSES.includes(body.newStatus as LeadStatus)
    ) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const newStatus = body.newStatus as LeadStatus;

    const offerRows = await db
      .select()
      .from(leadOffers)
      .where(and(eq(leadOffers.id, body.leadOfferId), eq(leadOffers.agentId, agent.id)))
      .limit(1);
    const offer = offerRows[0];
    if (!offer || offer.status !== 'accepted') {
      return NextResponse.json({ error: 'offer_not_found' }, { status: 404 });
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
        return NextResponse.json({ error: 'must_contact_before_lost' }, { status: 400 });
      }
      if (!isLostReason(body.lostReason)) {
        return NextResponse.json({ error: 'lost_reason_required' }, { status: 400 });
      }
    }

    const now = new Date();

    await db.insert(statusUpdates).values({
      leadOfferId: offer.id,
      leadId: offer.leadId,
      agentId: agent.id,
      newStatus,
      note: body.note ?? null,
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
      leadUpdate.lostReason = body.lostReason;
      leadUpdate.lostAt = now;
    }
    await db.update(leads).set(leadUpdate).where(eq(leads.id, offer.leadId));

    await logLeadEvent(
      offer.leadId,
      newStatus === 'lost' ? 'marked_lost' : 'status_updated',
      newStatus === 'lost'
        ? `Lost — ${body.lostReason}${body.note ? ` · ${body.note}` : ''}`
        : body.note
          ? `${newStatus} — ${body.note}`
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
          agentId: agent.id,
          reason: 'pipeline_attempted',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });
      } else if (newStatus === 'contacted') {
        await applyScore({
          agentId: agent.id,
          reason: 'pipeline_contacted',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });
        if (acceptedAt && now.getTime() - acceptedAt.getTime() <= DAY_MS) {
          await applyScore({
            agentId: agent.id,
            reason: 'fast_contact_bonus',
            leadId: offer.leadId,
            leadOfferId: offer.id,
          });
        }
      } else if (newStatus === 'qualified') {
        await applyScore({
          agentId: agent.id,
          reason: 'pipeline_qualified',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });
      } else if (newStatus === 'closed') {
        await applyScore({
          agentId: agent.id,
          reason: 'system_closing',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });
      }
    } catch (err) {
      console.error('[api/agent/status-update] applyScore failed:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/status-update] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
