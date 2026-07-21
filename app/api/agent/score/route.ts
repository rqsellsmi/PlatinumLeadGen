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
import { slotCountForScore } from '@/lib/routing';

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

  // Slot-threshold math: slots = 1 + floor(sqrt(score/10)), so the score needed
  // for `s` slots is 10*(s-1)^2. Progress is measured between the threshold for
  // the agent's current slot count and the threshold for the next one.
  const slots = slotCountForScore(queueScore);
  const nextThreshold = 10 * slots * slots;
  const prevThreshold = 10 * (slots - 1) * (slots - 1);
  const pointsToNextSlot = Math.max(0, Math.ceil(nextThreshold - queueScore));
  const slotProgressPct = Math.max(
    0,
    Math.min(100, ((queueScore - prevThreshold) / (nextThreshold - prevThreshold)) * 100)
  );

  return NextResponse.json({
    queueScore,
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
