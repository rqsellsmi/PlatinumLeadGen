/**
 * Lead lifecycle v2 (spec v2 §4): Lost reasons + the 30-day stall window.
 * Shared by the status-update route/form, the stall cron, and admin views.
 */

export const LOST_REASONS = [
  'buyer_chose_other_agent',
  'unresponsive',
  'financing_fell_through',
  'relisted_elsewhere',
  'price_mismatch',
  'other',
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export function isLostReason(v: unknown): v is LostReason {
  return typeof v === 'string' && (LOST_REASONS as readonly string[]).includes(v);
}

export function lostReasonLabel(reason: string): string {
  const map: Record<LostReason, string> = {
    buyer_chose_other_agent: 'Chose another agent',
    unresponsive: 'Went unresponsive',
    financing_fell_through: 'Financing fell through',
    relisted_elsewhere: 'Relisted elsewhere',
    price_mismatch: 'Price mismatch',
    other: 'Other',
  };
  return (map as Record<string, string>)[reason] ?? reason;
}

/** A Qualified lead idle this long incurs a recurring stall penalty (spec v2 §4.3). */
export const STALL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
