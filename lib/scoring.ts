/**
 * Agent score system (Section 5.4).
 * Applies a score delta, logs it to agent_score_log, and updates the agent's score.
 */
import { sql } from 'drizzle-orm';
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
  | 'manual_adjustment';

/** Fixed deltas for system reasons (Section 5.4). manual_adjustment is variable. */
export const SCORE_DELTAS: Record<Exclude<ScoreReason, 'manual_adjustment'>, number> = {
  system_response_fast: 7.5,
  system_response_good: 5.0,
  system_response_slow: 2.0,
  system_no_response: -1.5,
  system_decline: -1.0,
  system_closing: 15.0,
  pipeline_contacted: 2.0,
  fast_contact_bonus: 3.0,
  pipeline_qualified: 2.0,
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
 * Resolve the delta for a reason: fixed for system reasons, caller-supplied for manual.
 */
export function resolveScoreDelta(reason: ScoreReason, delta?: number): number {
  if (reason === 'manual_adjustment') {
    if (delta === undefined) throw new Error('manual_adjustment requires an explicit delta');
    return delta;
  }
  return SCORE_DELTAS[reason];
}

/**
 * Apply a score change: insert a log row and increment the agent's score atomically.
 * For manual_adjustment a `note` (reason) is required.
 */
export async function applyScore(args: ApplyScoreArgs): Promise<number> {
  const delta = resolveScoreDelta(args.reason, args.delta);
  if (args.reason === 'manual_adjustment' && !args.note?.trim()) {
    throw new Error('manual_adjustment requires a reason note');
  }

  await db.insert(agentScoreLog).values({
    agentId: args.agentId,
    delta,
    reason: args.reason,
    note: args.note ?? null,
    leadId: args.leadId ?? null,
    leadOfferId: args.leadOfferId ?? null,
  });

  await db
    .update(agents)
    .set({ score: sql`${agents.score} + ${delta}`, updatedAt: new Date() })
    .where(sql`${agents.id} = ${args.agentId}`);

  return delta;
}
