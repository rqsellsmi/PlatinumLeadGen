/**
 * GET /api/agent/score — current score, tier, and recent score events for the
 * authenticated agent. (v1.6 §F.3)
 */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentScoreLog } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { tierFor, scoreReasonLabel } from '@/lib/scoreTiers';
import { loadTierContext } from '@/lib/scoreTiersServer';
import { slotCountForScore, queueStandingFor } from '@/lib/routing';
import { STARTING_CREDIT } from '@/lib/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const agent = await getCurrentAgent();
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const events = await db
    .select({
      id: agentScoreLog.id,
      delta: agentScoreLog.delta,
      reason: agentScoreLog.reason,
      note: agentScoreLog.note,
      isNegated: agentScoreLog.isNegated,
      createdAt: agentScoreLog.createdAt,
    })
    .from(agentScoreLog)
    .where(eq(agentScoreLog.agentId, agent.id))
    .orderBy(desc(agentScoreLog.createdAt))
    .limit(15);

  // The agent portal surfaces all four score tracks (spec v2 §1/§6):
  //  - queueScore (rolling-365) drives rotation slots — the hero number.
  //  - lifetime drives the tier badge (percentile vs. the active cohort).
  //  - monthly / ytd feed the monthly / YTD leaderboards.
  const queueScore = agent.scoreRolling365 ?? 0;
  const lifetime = agent.scoreLifetime ?? 0;
  const monthly = agent.scoreMonthly ?? 0;
  const ytd = agent.scoreYtd ?? 0;
  const tier = tierFor(lifetime, await loadTierContext());

  // Queue standing is gated on MEMBERSHIP, not on the score. slotCountForScore
  // never returns less than 1, so applying it directly reported "1 slot in the
  // lead queue" to agents who had never turned availability on and were not in
  // the rotation at all — contradicting the admin's (correct) empty-queue view.
  // Same membership test the router uses in getActiveRoutingAgents.
  const inQueue = agent.isActive === true && agent.queueJoinedAt != null;
  const { slots, pointsToNextSlot, slotProgressPct } = queueStandingFor({
    inQueue,
    queueScore,
  });
  // The one-time head start is granted on first activation, so an agent who has
  // not joined yet can be told exactly what joining is worth.
  const headStart = agent.startingCreditGrantedAt == null ? STARTING_CREDIT : 0;

  return NextResponse.json({
    queueScore,
    inQueue,
    headStart,
    headStartSlots: headStart > 0 ? slotCountForScore(headStart) : 0,
    slots,
    pointsToNextSlot,
    slotProgressPct,
    lifetime,
    tier: tier.label,
    tierColor: tier.color,
    monthly,
    ytd,
    recentEvents: events.map((e) => ({
      id: e.id,
      delta: e.delta,
      reason: e.reason,
      label: scoreReasonLabel(e.reason),
      note: e.note,
      isNegated: e.isNegated ?? false,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    })),
  });
}
