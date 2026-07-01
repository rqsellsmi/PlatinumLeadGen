/**
 * Agent score system (Section 5.4).
 * Applies a score delta, logs it to agent_score_log, and updates the agent's score.
 */
import { eq, sql } from 'drizzle-orm';
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
  | 'lead_deleted_reversal'
  | 'manual_adjustment';

/** Score bounds (v1.6 §E.2 / §J). */
export const SCORE_MIN = 0;
export const SCORE_MAX = 200;

/**
 * Fixed deltas for system reasons. manual_adjustment and lead_deleted_reversal
 * are variable (caller supplies the delta). system_response_fast defaults to the
 * <15-minute tier (+10); the 15–30 minute tier passes an explicit +7.65 (§E.3).
 */
export const SCORE_DELTAS: Record<
  Exclude<ScoreReason, 'manual_adjustment' | 'lead_deleted_reversal'>,
  number
> = {
  system_response_fast: 10.0, // <15 min (15–30 min passes explicit +7.65)
  system_response_good: 5.0, // 30–60 min
  system_response_slow: 2.0, // 60 min–3 h
  system_no_response: -1.5,
  system_decline: -3.0, // §E.4 / §J
  system_closing: 15.0,
  pipeline_contacted: 2.0,
  fast_contact_bonus: 3.0,
  pipeline_qualified: 2.0,
  stale_48h: -1.0,
  stale_7day: -1.0,
};

export interface ApplyScoreArgs {
  agentId: number;
  reason: ScoreReason;
  /** Required for manual_adjustment; ignored for system reasons (looked up). */
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
 * Apply a score change: insert a log row and set the agent's score, clamped to
 * [0, 200] (§E.2). For manual_adjustment a `note` (reason) is required. Returns
 * the delta actually applied after clamping.
 */
export async function applyScore(args: ApplyScoreArgs): Promise<number> {
  const requested = resolveScoreDelta(args.reason, args.delta);
  if (args.reason === 'manual_adjustment' && !args.note?.trim()) {
    throw new Error('manual_adjustment requires a reason note');
  }

  // Read current score, clamp the result, and record the delta actually applied.
  const rows = await db.select({ score: agents.score }).from(agents).where(eq(agents.id, args.agentId)).limit(1);
  const current = rows[0]?.score ?? 0;
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, current + requested));
  const applied = clamped - current;

  await db.insert(agentScoreLog).values({
    agentId: args.agentId,
    delta: applied,
    reason: args.reason,
    note: args.note ?? null,
    leadId: args.leadId ?? null,
    leadOfferId: args.leadOfferId ?? null,
  });

  await db.update(agents).set({ score: clamped, updatedAt: new Date() }).where(eq(agents.id, args.agentId));

  return applied;
}
