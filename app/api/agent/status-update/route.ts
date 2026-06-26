/**
 * POST /api/agent/status-update — agent submits a pipeline status update. (Section 9)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, statusUpdates } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { applyScore } from '@/lib/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'closed', 'lost'] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const agent = await getCurrentAgent();
    if (!agent) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { leadOfferId?: number; newStatus?: string; note?: string }
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

    const now = new Date();

    await db.insert(statusUpdates).values({
      leadOfferId: offer.id,
      leadId: offer.leadId,
      agentId: agent.id,
      newStatus,
      note: body.note ?? null,
    });

    await db
      .update(leads)
      .set({ status: newStatus, lastStatusChangedAt: now, updatedAt: now })
      .where(eq(leads.id, offer.leadId));

    // Mark first update if this is the agent's first one for this offer.
    const isFirstUpdate = offer.firstUpdateSubmittedAt == null;
    if (isFirstUpdate) {
      await db
        .update(leadOffers)
        .set({ firstUpdateSubmittedAt: now, updatedAt: now })
        .where(eq(leadOffers.id, offer.id));
    }

    // Pipeline scoring.
    const leadRows = await db
      .select({ acceptedAt: leads.acceptedAt })
      .from(leads)
      .where(eq(leads.id, offer.leadId))
      .limit(1);
    const acceptedAt = leadRows[0]?.acceptedAt ?? offer.acceptedAt ?? null;

    try {
      if (newStatus === 'contacted') {
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
