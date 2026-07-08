/**
 * Agent score system — Scoring v2 (spec v2).
 *
 * Every scoring event writes one immutable row to agent_score_log and updates
 * FOUR aggregate tracks on the agent in the same call:
 *   - score_lifetime   never resets (tier label, private profile)
 *   - score_ytd        reset Jan 1 (YTD leaderboard)
 *   - score_monthly    reset 1st of month (monthly leaderboard)
 *   - score_rolling_365 trailing-365-day sum (drives routing slots ONLY)
 *
 * Lifetime/ytd/monthly are maintained incrementally (and reset by the
 * score-maintenance cron); rolling-365 is derived from the log (sum of deltas in
 * the trailing 365 days) so it decays as events age out. There is NO score clamp
 * in v2 — the score is uncapped.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { agents, agentScoreLog } from '../drizzle/schema';

export type ScoreReason =
  | 'system_response_fast'
  | 'system_response_good'
  | 'system_response_slow'
  | 'system_no_response'
  | 'system_decline'
  | 'system_closing'
  | 'pipeline_contacted'
  | 'fast_contact_bonus'
  | 'pipeline_qualified'
  | 'stale_48h'
  | 'stale_7day'
  | 'pipeline_stalled'
  | 'lead_deleted_reversal'
  | 'manual_adjustment';

const ROLLING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Fixed deltas for system reasons (spec v2 §2). manual_adjustment and
 * lead_deleted_reversal are variable (caller supplies the delta).
 * system_response_fast is the <15-minute tier (+8); the 15–30 minute tier passes
 * an explicit +6.
 */
export const SCORE_DELTAS: Record<
  Exclude<ScoreReason, 'manual_adjustment' | 'lead_deleted_reversal'>,
  number
> = {
  system_response_fast: 8.0, // <15 min (15–30 min passes explicit +6)
  system_response_good: 4.0, // 30–60 min
  system_response_slow: 1.0, // 60 min–3 h
  system_no_response: -4.0, // offer expired (worse than decline — ties the lead up 3h)
  system_decline: -3.0,
  system_closing: 25.0, // closing should dominate the score
  pipeline_contacted: 2.0,
  fast_contact_bonus: 3.0,
  pipeline_qualified: 2.0,
  stale_48h: -2.0,
  stale_7day: -2.0, // recurs weekly until first update
  pipeline_stalled: -3.0, // Qualified idle 30d, recurs every 30d until Closed/Lost
};

export interface ApplyScoreArgs {
  agentId: number;
  reason: ScoreReason;
  /** Required for manual_adjustment / lead_deleted_reversal; else looked up. */
  delta?: number;
  /** Required for manual_adjustment. */
  note?: string;
  leadId?: number;
  leadOfferId?: number;
}

/**
 * Resolve the delta for a reason: a caller-supplied delta always wins (needed for
 * the 15–30 min accept tier and reversals); otherwise fixed for system reasons.
 */
export function resolveScoreDelta(reason: ScoreReason, delta?: number): number {
  if (reason === 'manual_adjustment' || reason === 'lead_deleted_reversal') {
    if (delta === undefined) throw new Error(`${reason} requires an explicit delta`);
    return delta;
  }
  if (delta !== undefined) return delta;
  return SCORE_DELTAS[reason];
}

/**
 * Apply a score change: insert a log row and update all four tracks. No clamp
 * (v2 is uncapped). Returns the delta applied.
 */
export async function applyScore(args: ApplyScoreArgs): Promise<number> {
  const delta = resolveScoreDelta(args.reason, args.delta);
  if (args.reason === 'manual_adjustment' && !args.note?.trim()) {
    throw new Error('manual_adjustment requires a reason note');
  }

  const now = new Date();

  await db.insert(agentScoreLog).values({
    agentId: args.agentId,
    delta,
    reason: args.reason,
    note: args.note ?? null,
    leadId: args.leadId ?? null,
    leadOfferId: args.leadOfferId ?? null,
    createdAt: now,
  });

  // Rolling-365 = sum of the agent's log deltas in the trailing 365 days
  // (includes the row just inserted; naturally decays as rows age out).
  const since = new Date(now.getTime() - ROLLING_WINDOW_MS);
  const rollRows = await db
    .select({ total: sql<number>`coalesce(sum(${agentScoreLog.delta}), 0)` })
    .from(agentScoreLog)
    .where(and(eq(agentScoreLog.agentId, args.agentId), gte(agentScoreLog.createdAt, since)));
  const rolling = Number(rollRows[0]?.total ?? 0);

  await db
    .update(agents)
    .set({
      scoreLifetime: sql`${agents.scoreLifetime} + ${delta}`,
      scoreYtd: sql`${agents.scoreYtd} + ${delta}`,
      scoreMonthly: sql`${agents.scoreMonthly} + ${delta}`,
      scoreRolling365: rolling,
      score: sql`${agents.scoreLifetime} + ${delta}`, // mirror lifetime for back-compat reads
      updatedAt: now,
    })
    .where(eq(agents.id, args.agentId));

  return delta;
}

/** Recompute one agent's rolling-365 from the log (used by the maintenance cron). */
export async function recomputeRolling365(agentId: number, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - ROLLING_WINDOW_MS);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${agentScoreLog.delta}), 0)` })
    .from(agentScoreLog)
    .where(and(eq(agentScoreLog.agentId, agentId), gte(agentScoreLog.createdAt, since)));
  const rolling = Number(rows[0]?.total ?? 0);
  await db.update(agents).set({ scoreRolling365: rolling }).where(eq(agents.id, agentId));
  return rolling;
}
