/**
 * Track configuration — one pipeline, two tunable "tracks".
 *
 * The seller and buyer lead pipelines share the SAME engine
 * (`recordStatusUpdate`, `applyAccept`, `autoOfferLead`, the update clock) and
 * the SAME agent score tracks + rotation queue. They differ only in this config,
 * selected by `leads.intent`:
 *   - allowed transitions / settable statuses,
 *   - origin-scoped Lost reasons + labels,
 *   - which score reason + point value each pipeline milestone pays.
 *
 * `SELLER_TRACK` wraps today's Scoring v4 constants (behavior unchanged).
 * `BUYER_TRACK` is initialized as a mirror of the seller flow per the owner's
 * 2026-07-25 schema — it drops the `appointment_set` stage, uses buyer-specific
 * Lost reasons, allows `closed → nurturing` (repeat client), and pays the buyer_*
 * score reasons (tunable independently in SCORE_DELTAS).
 */
import type { ScoreReason, LeadMilestone } from './scoring';
import {
  AGENT_SETTABLE_STATUSES_V4,
  ALLOWED_TRANSITIONS as SELLER_TRANSITIONS,
  isValidTransition as sellerIsValidTransition,
  isBackwardMove as sellerIsBackwardMove,
  lostReasonsForOrigin as sellerLostReasonsForOrigin,
  isValidLostReasonForOrigin as sellerIsValidLostReasonForOrigin,
  v4LostReasonLabel,
  ATTEMPTED_CONTACTS_FOR_LOST,
} from './leadLifecycle';

export interface PipelineMilestone {
  key: LeadMilestone;
  reason: ScoreReason;
}

export interface TrackConfig {
  key: 'seller' | 'buyer';
  settableStatuses: readonly string[];
  /** The statuses an agent may move a lead TO from `status` (for the UI picker). */
  allowedFrom(status: string): readonly string[];
  isValidTransition(from: string, to: string): boolean;
  isBackwardMove(from: string, to: string): boolean;
  lostReasonsForOrigin(origin: string, attemptedCount?: number): string[];
  isValidLostReasonForOrigin(origin: string, reason: string | null | undefined, attemptedCount?: number): boolean;
  lostReasonLabel(reason: string): string;
  /** The once-only milestone (guard column + score reason) a status pays, if any. */
  pipelineMilestone(status: string): PipelineMilestone | null;
  /** Score reason for Closed Won (paid directly, not milestone-guarded). */
  closingReason: ScoreReason;
  /** Score reason for the first-engagement speed bonus. */
  fastEngagementReason: ScoreReason;
}

// ===========================================================================
// Seller Track — wraps the existing v4 constants (unchanged behavior).
// ===========================================================================
export const SELLER_TRACK: TrackConfig = {
  key: 'seller',
  settableStatuses: AGENT_SETTABLE_STATUSES_V4,
  allowedFrom: (status) => SELLER_TRANSITIONS[status] ?? [],
  isValidTransition: sellerIsValidTransition,
  isBackwardMove: sellerIsBackwardMove,
  lostReasonsForOrigin: sellerLostReasonsForOrigin,
  isValidLostReasonForOrigin: sellerIsValidLostReasonForOrigin,
  lostReasonLabel: v4LostReasonLabel,
  pipelineMilestone(status) {
    switch (status) {
      case 'attempted_contact':
        return { key: 'attempted_contact', reason: 'pipeline_attempted' };
      case 'connected':
        return { key: 'connected', reason: 'pipeline_contacted' };
      case 'appointment_set':
        return { key: 'appointment_set', reason: 'milestone_appointment_set' };
      case 'signed':
        return { key: 'signed', reason: 'milestone_signed' };
      default:
        return null;
    }
  },
  closingReason: 'system_closing',
  fastEngagementReason: 'fast_engagement',
};

// ===========================================================================
// Buyer Track — the owner's 2026-07-25 schema. Reuses the seller lead_status
// values; drops appointment_set; buyer-specific Lost reasons; closed→nurturing.
// ===========================================================================
export const BUYER_SETTABLE_STATUSES = [
  'attempted_contact',
  'connected',
  'nurturing',
  'signed',
  'closed',
  'lost',
] as const;

const BUYER_TRANSITIONS: Record<string, readonly string[]> = {
  new: ['attempted_contact', 'connected'],
  reopened: ['attempted_contact', 'connected'],
  attempted_contact: ['connected', 'lost'],
  connected: ['nurturing', 'lost'],
  nurturing: ['signed', 'lost'], // NO appointment_set
  signed: ['closed', 'nurturing', 'lost'], // backward to nurturing kept
  closed: ['nurturing'], // repeat client re-enters the pipeline
  lost: [],
};

// Buyer Lost reasons by origin (owner's schema).
const BUYER_LOST_A = ['bad_number', 'wrong_number', 'email_bounced'] as const; // Attempted Contact
const BUYER_LOST_A2 = ['no_response_after_6'] as const; // Attempted Contact, gated at 6
const BUYER_LOST_B = ['just_looking', 'already_have_agent'] as const; // Connected
const BUYER_LOST_C = [
  'stopped_responding',
  'selected_another_agent',
  'changed_plans',
  'preapproval_denied',
  'found_home_without_agent',
] as const; // Nurturing
const BUYER_LOST_D = [
  'terminated_for_another_agent',
  'financing_fell_through',
  'decided_to_stop_looking',
  'stopped_responding',
] as const; // Signed

const BUYER_LOST_LABELS: Record<string, string> = {
  preapproval_denied: 'Pre-approval denied',
  found_home_without_agent: 'Found home without an agent',
  financing_fell_through: 'Financing fell through',
  decided_to_stop_looking: 'Decided to stop looking',
};

function buyerLostReasonsForOrigin(origin: string, attemptedCount = 0): string[] {
  switch (origin) {
    case 'attempted_contact':
      return [...BUYER_LOST_A, ...(attemptedCount >= ATTEMPTED_CONTACTS_FOR_LOST ? BUYER_LOST_A2 : [])];
    case 'connected':
      return [...BUYER_LOST_B];
    case 'nurturing':
      return [...BUYER_LOST_C];
    case 'signed':
      return [...BUYER_LOST_D];
    default:
      return [];
  }
}

export const BUYER_TRACK: TrackConfig = {
  key: 'buyer',
  settableStatuses: BUYER_SETTABLE_STATUSES,
  allowedFrom: (status) => BUYER_TRANSITIONS[status] ?? [],
  isValidTransition(from, to) {
    return (BUYER_TRANSITIONS[from] ?? []).includes(to);
  },
  isBackwardMove(from, to) {
    return to === 'nurturing' && (from === 'signed' || from === 'closed');
  },
  lostReasonsForOrigin: buyerLostReasonsForOrigin,
  isValidLostReasonForOrigin(origin, reason, attemptedCount = 0) {
    return !!reason && buyerLostReasonsForOrigin(origin, attemptedCount).includes(reason);
  },
  lostReasonLabel(reason) {
    return BUYER_LOST_LABELS[reason] ?? v4LostReasonLabel(reason);
  },
  pipelineMilestone(status) {
    switch (status) {
      case 'attempted_contact':
        return { key: 'attempted_contact', reason: 'buyer_attempted' };
      case 'connected':
        return { key: 'connected', reason: 'buyer_connected' };
      case 'signed':
        return { key: 'signed', reason: 'buyer_signed' };
      default:
        return null;
    }
  },
  closingReason: 'buyer_closing',
  fastEngagementReason: 'buyer_fast_engagement',
};

/** Pick the track config for a lead's intent. */
export function trackConfig(intent: string | null | undefined): TrackConfig {
  return intent === 'buyer' ? BUYER_TRACK : SELLER_TRACK;
}
