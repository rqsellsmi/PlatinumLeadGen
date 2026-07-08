/**
 * Agent score tiers + reason labels.
 *
 * Tiers are now RELATIVE to the active-agent cohort (by lifetime score):
 * "Top Performer" is the top 10%, then each tier works down. Callers load a
 * TierContext (the cohort's lifetime scores) once and apply it per agent. This
 * module stays pure (no DB) so client components can import it; the DB loader
 * lives in lib/scoreTiersServer.ts.
 */

export interface ScoreTier {
  label: string;
  /** Tailwind text color class. */
  color: string;
}

export interface TierContext {
  /** Ascending lifetime scores of all active agents. */
  sortedScores: number[];
}

// Percentile floors, highest first. Top 10% → Top Performer; bottom 10% → At Risk.
const TIERS: { minPercentile: number; label: string; color: string }[] = [
  { minPercentile: 0.9, label: 'Top Performer', color: 'text-green-700' },
  { minPercentile: 0.7, label: 'Strong', color: 'text-green-600' },
  { minPercentile: 0.5, label: 'Good Standing', color: 'text-blue-600' },
  { minPercentile: 0.3, label: 'Average', color: 'text-amber-600' },
  { minPercentile: 0.1, label: 'Needs Improvement', color: 'text-orange-600' },
  { minPercentile: 0.0, label: 'At Risk', color: 'text-red-600' },
];

const UNRANKED: ScoreTier = { label: 'Unranked', color: 'text-mute' };

/**
 * Percentile rank of `score` within the cohort, in [0,1] — the midrank
 * (fraction strictly below + half the ties). Ties share a rank, so when the
 * whole cohort is equal everyone lands mid-pack (0.5) rather than all bottoming
 * out — which matters at cutover when many agents share the same score.
 */
export function percentileRank(score: number, ctx: TierContext): number {
  const n = ctx.sortedScores.length;
  if (n === 0) return 1;
  let below = 0;
  let equal = 0;
  for (const s of ctx.sortedScores) {
    if (s < score) below += 1;
    else if (s === score) equal += 1;
  }
  return (below + 0.5 * equal) / n;
}

/** Map a percentile in [0,1] to a tier. */
export function tierForPercentile(p: number): ScoreTier {
  for (const t of TIERS) if (p >= t.minPercentile) return { label: t.label, color: t.color };
  const last = TIERS[TIERS.length - 1];
  return { label: last.label, color: last.color };
}

/** Tier for an agent's lifetime score within the active cohort. */
export function tierFor(score: number, ctx: TierContext): ScoreTier {
  if (ctx.sortedScores.length === 0) return UNRANKED;
  return tierForPercentile(percentileRank(score, ctx));
}

/** Human-readable label for a score_reason enum value. */
export function scoreReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    system_response_fast: 'Fast response',
    system_response_good: 'Quick response',
    system_response_slow: 'Slow response',
    system_no_response: 'No response',
    system_decline: 'Declined lead',
    system_closing: 'Closed deal',
    pipeline_contacted: 'Contacted lead',
    fast_contact_bonus: 'Fast contact bonus',
    pipeline_qualified: 'Qualified lead',
    stale_48h: 'No update (48h)',
    stale_7day: 'No update (weekly)',
    pipeline_stalled: 'Stalled 30 days',
    lead_deleted_reversal: 'Penalty reversed',
    manual_adjustment: 'Admin adjustment',
  };
  return map[reason] ?? reason;
}
