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

/**
 * Marking a lead Lost is gated: the agent must have either reached Contacted, or
 * logged this many Attempted-Contact updates (repeated genuine outreach attempts
 * that never produced a live conversation). This stops agents dumping a lead as
 * Lost before they've actually tried to reach the seller.
 */
export const ATTEMPTED_CONTACTS_FOR_LOST = 6;

/**
 * Whether an agent may mark a lead Lost. Unlocked once the lead has been
 * Contacted, or after enough Attempted-Contact updates.
 */
export function canMarkLost(opts: {
  contactedAt?: Date | string | null;
  attemptedContactCount?: number;
}): boolean {
  if (opts.contactedAt != null) return true;
  return (opts.attemptedContactCount ?? 0) >= ATTEMPTED_CONTACTS_FOR_LOST;
}

/** Human-facing labels for the lead pipeline statuses (v4 + retired v2). */
export function leadStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'New',
    attempted_contact: 'Attempted contact',
    connected: 'Connected',
    nurturing: 'Nurturing',
    appointment_set: 'Appointment set',
    signed: 'Signed',
    closed: 'Closed',
    lost: 'Lost',
    reopened: 'Reopened',
    // retired v2 statuses (still label cleanly if any legacy row shows one)
    contacted: 'Contacted',
    qualified: 'Qualified',
    working: 'Working',
  };
  return map[status] ?? status;
}

// ===========================================================================
// Scoring v4 — Seller Track status flow, transitions, and origin-scoped Lost.
// See docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md.
// ===========================================================================

/** The v4 Seller Track statuses an agent can move a lead TO (not `new`/`reopened`). */
export const AGENT_SETTABLE_STATUSES_V4 = [
  'attempted_contact',
  'connected',
  'nurturing',
  'appointment_set',
  'signed',
  'closed',
  'lost',
] as const;
export type AgentSettableStatusV4 = (typeof AGENT_SETTABLE_STATUSES_V4)[number];

/**
 * Allowed forward/backward transitions per current status (v4 §3). `new` and
 * `reopened` share the same options; `reopened` behaves like New. Backward moves
 * to `nurturing` (from appointment_set / signed) are permitted and reason-free.
 */
export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  new: ['attempted_contact', 'connected'],
  reopened: ['attempted_contact', 'connected'],
  attempted_contact: ['connected', 'lost'],
  connected: ['nurturing', 'lost'],
  nurturing: ['appointment_set', 'lost'],
  appointment_set: ['signed', 'nurturing', 'lost'],
  signed: ['closed', 'nurturing', 'lost'],
  closed: [],
  lost: [],
};

export function isValidTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** A backward move keeps the lead active but drops it to Nurturing (v4 §3, D3). */
export function isBackwardMove(from: string, to: string): boolean {
  return to === 'nurturing' && (from === 'appointment_set' || from === 'signed');
}

// --- Lost reasons, scoped by the origin status being left (v4 §6) ----------
export const LOST_A = ['bad_number', 'wrong_number', 'email_bounced'] as const; // from Attempted Contact
export const LOST_A2 = ['no_response_after_6'] as const; // from Attempted Contact, gated at 6 attempts
export const LOST_B = ['already_listed_or_sold', 'just_looking', 'already_have_agent'] as const; // from Connected
export const LOST_C = ['stopped_responding', 'selected_another_agent', 'changed_plans'] as const; // Nurturing/Appt
export const LOST_D = ['listing_withdrawn', 'listing_expired', 'terminated_for_another_agent'] as const; // Signed

export const ALL_V4_LOST_REASONS = [
  ...LOST_A,
  ...LOST_A2,
  ...LOST_B,
  ...LOST_C,
  ...LOST_D,
] as const;
export type V4LostReason = (typeof ALL_V4_LOST_REASONS)[number];

/**
 * The Lost reasons available from a given origin status. Lost A2 (no response
 * after 6) only appears once the lead has ≥6 logged Attempted-Contact updates.
 * Returns [] for a status Lost isn't reachable from.
 */
export function lostReasonsForOrigin(originStatus: string, attemptedContactCount = 0): string[] {
  switch (originStatus) {
    case 'attempted_contact':
      return [...LOST_A, ...(attemptedContactCount >= ATTEMPTED_CONTACTS_FOR_LOST ? LOST_A2 : [])];
    case 'connected':
      return [...LOST_B];
    case 'nurturing':
    case 'appointment_set':
      return [...LOST_C];
    case 'signed':
      return [...LOST_D];
    default:
      return [];
  }
}

export function isValidLostReasonForOrigin(
  originStatus: string,
  reason: string | null | undefined,
  attemptedContactCount = 0,
): boolean {
  return !!reason && lostReasonsForOrigin(originStatus, attemptedContactCount).includes(reason);
}

/** Human-facing labels for the v4 Lost reasons. */
export function v4LostReasonLabel(reason: string): string {
  const map: Record<V4LostReason, string> = {
    bad_number: 'Bad number',
    wrong_number: 'Wrong number',
    email_bounced: 'Email bounced',
    no_response_after_6: 'No response after 6 attempts',
    already_listed_or_sold: 'Already listed / recently sold',
    just_looking: 'Just looking',
    already_have_agent: 'Already have an agent',
    stopped_responding: 'Stopped responding',
    selected_another_agent: 'Selected another agent',
    changed_plans: 'Changed plans',
    listing_withdrawn: 'Listing withdrawn',
    listing_expired: 'Listing expired',
    terminated_for_another_agent: 'Terminated for another agent',
  };
  return (map as Record<string, string>)[reason] ?? reason;
}
