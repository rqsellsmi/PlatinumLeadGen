import { describe, it, expect } from 'vitest';
import { trackConfig, SELLER_TRACK, BUYER_TRACK } from '../lib/trackConfig';

describe('trackConfig selection', () => {
  it('returns the buyer track only for intent="buyer"', () => {
    expect(trackConfig('buyer')).toBe(BUYER_TRACK);
    expect(trackConfig('seller')).toBe(SELLER_TRACK);
    expect(trackConfig('unknown')).toBe(SELLER_TRACK);
    expect(trackConfig(null)).toBe(SELLER_TRACK);
    expect(trackConfig(undefined)).toBe(SELLER_TRACK);
  });
});

describe('BUYER_TRACK transitions', () => {
  it('follows new → attempted → connected → nurturing → signed → closed', () => {
    expect(BUYER_TRACK.isValidTransition('new', 'attempted_contact')).toBe(true);
    expect(BUYER_TRACK.isValidTransition('new', 'connected')).toBe(true);
    expect(BUYER_TRACK.isValidTransition('attempted_contact', 'connected')).toBe(true);
    expect(BUYER_TRACK.isValidTransition('connected', 'nurturing')).toBe(true);
    expect(BUYER_TRACK.isValidTransition('nurturing', 'signed')).toBe(true);
    expect(BUYER_TRACK.isValidTransition('signed', 'closed')).toBe(true);
  });

  it('has NO appointment_set stage', () => {
    expect(BUYER_TRACK.settableStatuses).not.toContain('appointment_set');
    expect(BUYER_TRACK.isValidTransition('nurturing', 'appointment_set')).toBe(false);
    expect(BUYER_TRACK.allowedFrom('nurturing')).not.toContain('appointment_set');
  });

  it('allows the closed → nurturing repeat-client move', () => {
    expect(BUYER_TRACK.isValidTransition('closed', 'nurturing')).toBe(true);
    expect(BUYER_TRACK.isBackwardMove('closed', 'nurturing')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(BUYER_TRACK.isValidTransition('new', 'signed')).toBe(false);
    expect(BUYER_TRACK.isValidTransition('connected', 'closed')).toBe(false);
    expect(BUYER_TRACK.isValidTransition('lost', 'connected')).toBe(false);
  });

  it('treats signed → nurturing as a reason-free backward move', () => {
    expect(BUYER_TRACK.isValidTransition('signed', 'nurturing')).toBe(true);
    expect(BUYER_TRACK.isBackwardMove('signed', 'nurturing')).toBe(true);
  });
});

describe('BUYER_TRACK lost reasons', () => {
  it('gives buyer-specific reasons per origin', () => {
    expect(BUYER_TRACK.lostReasonsForOrigin('connected')).toEqual(['just_looking', 'already_have_agent']);
    expect(BUYER_TRACK.lostReasonsForOrigin('nurturing')).toContain('preapproval_denied');
    expect(BUYER_TRACK.lostReasonsForOrigin('nurturing')).toContain('found_home_without_agent');
    expect(BUYER_TRACK.lostReasonsForOrigin('signed')).toContain('financing_fell_through');
    expect(BUYER_TRACK.lostReasonsForOrigin('signed')).toContain('decided_to_stop_looking');
  });

  it('gates Lost A2 (no response after 6) at 6 attempts', () => {
    expect(BUYER_TRACK.lostReasonsForOrigin('attempted_contact', 3)).not.toContain('no_response_after_6');
    expect(BUYER_TRACK.lostReasonsForOrigin('attempted_contact', 6)).toContain('no_response_after_6');
  });

  it('validates a lost reason against its origin', () => {
    expect(BUYER_TRACK.isValidLostReasonForOrigin('connected', 'just_looking')).toBe(true);
    expect(BUYER_TRACK.isValidLostReasonForOrigin('connected', 'preapproval_denied')).toBe(false);
    expect(BUYER_TRACK.isValidLostReasonForOrigin('connected', null)).toBe(false);
  });

  it('labels new buyer reasons', () => {
    expect(BUYER_TRACK.lostReasonLabel('preapproval_denied')).toBe('Pre-approval denied');
    expect(BUYER_TRACK.lostReasonLabel('found_home_without_agent')).toBe('Found home without an agent');
    // falls back to the shared v4 labels for shared reasons
    expect(BUYER_TRACK.lostReasonLabel('stopped_responding')).toBe('Stopped responding');
  });
});

describe('BUYER_TRACK scoring reasons', () => {
  it('maps pipeline milestones to buyer_* reasons', () => {
    expect(BUYER_TRACK.pipelineMilestone('attempted_contact')).toEqual({ key: 'attempted_contact', reason: 'buyer_attempted' });
    expect(BUYER_TRACK.pipelineMilestone('connected')).toEqual({ key: 'connected', reason: 'buyer_connected' });
    expect(BUYER_TRACK.pipelineMilestone('signed')).toEqual({ key: 'signed', reason: 'buyer_signed' });
    expect(BUYER_TRACK.pipelineMilestone('nurturing')).toBeNull();
    expect(BUYER_TRACK.closingReason).toBe('buyer_closing');
    expect(BUYER_TRACK.fastEngagementReason).toBe('buyer_fast_engagement');
  });

  it('keeps the seller track paying the seller reasons (unchanged)', () => {
    expect(SELLER_TRACK.pipelineMilestone('appointment_set')).toEqual({ key: 'appointment_set', reason: 'milestone_appointment_set' });
    expect(SELLER_TRACK.closingReason).toBe('system_closing');
    expect(SELLER_TRACK.fastEngagementReason).toBe('fast_engagement');
  });
});
