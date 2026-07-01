/**
 * GET /api/agent/score — current score, tier, and recent score events for the
 * authenticated agent. (v1.6 §F.3)
 */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentScoreLog } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { scoreTier, scoreReasonLabel } from '@/lib/scoreTiers';

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

  const score = agent.score ?? 0;
  const tier = scoreTier(score);

  return NextResponse.json({
    score,
    tier: tier.label,
    tierColor: tier.color,
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
