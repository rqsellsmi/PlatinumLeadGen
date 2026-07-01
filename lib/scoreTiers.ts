/**
 * Agent score tiers + reason labels (v1.6 §F.2 / §K.8).
 * Tier boundaries and labels/colors are taken verbatim from the original
 * AgentPortal.tsx ScorePanel.
 */

export interface ScoreTier {
  label: string;
  /** Tailwind text color class. */
  color: string;
}

export function scoreTier(score: number): ScoreTier {
  if (score >= 100) return { label: 'Top Performer', color: 'text-green-700' };
  if (score >= 80) return { label: 'Strong', color: 'text-green-600' };
  if (score >= 60) return { label: 'Good Standing', color: 'text-blue-600' };
  if (score >= 40) return { label: 'Average', color: 'text-amber-600' };
  if (score >= 20) return { label: 'Needs Improvement', color: 'text-orange-600' };
  return { label: 'At Risk', color: 'text-red-600' };
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
    lead_deleted_reversal: 'Penalty reversed',
    manual_adjustment: 'Admin adjustment',
  };
  return map[reason] ?? reason;
}
