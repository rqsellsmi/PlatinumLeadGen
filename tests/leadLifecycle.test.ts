import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  isValidTransition,
  isBackwardMove,
  lostReasonsForOrigin,
  isValidLostReasonForOrigin,
  leadStatusLabel,
  v4LostReasonLabel,
  ATTEMPTED_CONTACTS_FOR_LOST,
} from '../lib/leadLifecycle';

describe('v4 status transitions', () => {
  it('allows the forward Seller Track path', () => {
    expect(isValidTransition('new', 'attempted_contact')).toBe(true);
    expect(isValidTransition('new', 'connected')).toBe(true); // skip attempted
    expect(isValidTransition('attempted_contact', 'connected')).toBe(true);
    expect(isValidTransition('connected', 'nurturing')).toBe(true);
    expect(isValidTransition('nurturing', 'appointment_set')).toBe(true);
    expect(isValidTransition('appointment_set', 'signed')).toBe(true);
    expect(isValidTransition('signed', 'closed')).toBe(true);
  });

  it('reopened behaves like new', () => {
    expect(isValidTransition('reopened', 'attempted_contact')).toBe(true);
    expect(isValidTransition('reopened', 'connected')).toBe(true);
  });

  it('allows the backward moves to nurturing', () => {
    expect(isValidTransition('appointment_set', 'nurturing')).toBe(true);
    expect(isValidTransition('signed', 'nurturing')).toBe(true);
  });

  it('rejects illegal jumps and moves out of terminal states', () => {
    expect(isValidTransition('new', 'signed')).toBe(false);
    expect(isValidTransition('new', 'lost')).toBe(false); // Lost not reachable from New
    expect(isValidTransition('connected', 'appointment_set')).toBe(false); // must pass Nurturing
    expect(isValidTransition('closed', 'nurturing')).toBe(false);
    expect(isValidTransition('lost', 'connected')).toBe(false);
  });

  it('identifies backward moves only for appt/signed -> nurturing', () => {
    expect(isBackwardMove('appointment_set', 'nurturing')).toBe(true);
    expect(isBackwardMove('signed', 'nurturing')).toBe(true);
    expect(isBackwardMove('connected', 'nurturing')).toBe(false); // forward, not backward
    expect(isBackwardMove('nurturing', 'appointment_set')).toBe(false);
  });
});

/**
 * Self-transitions are what make "log an update without moving the lead"
 * possible. Without them the only way to reset the update clock was to advance
 * the lead, so a genuine long-term nurture took a recurring −2 for doing the job
 * correctly, and the ≥6-attempt Lost reason could never be reached.
 */
describe('v4 same-stage check-ins', () => {
  it('every working stage can be re-logged without moving the lead', () => {
    for (const s of ['attempted_contact', 'connected', 'nurturing', 'appointment_set', 'signed']) {
      expect(isValidTransition(s, s)).toBe(true);
    }
  });

  it('a same-stage update is not a backward move', () => {
    expect(isBackwardMove('nurturing', 'nurturing')).toBe(false);
    expect(isBackwardMove('signed', 'signed')).toBe(false);
  });

  it('is the FIRST option, so the portal form defaults to "no change"', () => {
    // StatusUpdateForm pre-selects options[0]; the old default was the NEXT
    // stage, which meant saving a note without touching the dropdown advanced
    // the lead — from Signed that fired Closed Won (+25).
    for (const s of ['attempted_contact', 'connected', 'nurturing', 'appointment_set', 'signed']) {
      expect(ALLOWED_TRANSITIONS[s][0]).toBe(s);
    }
  });

  it('new and reopened have NO self-transition', () => {
    // Otherwise a lead could be parked at New indefinitely, resetting the clock
    // without any contact ever being attempted.
    expect(isValidTransition('new', 'new')).toBe(false);
    expect(isValidTransition('reopened', 'reopened')).toBe(false);
  });

  it('closed and lost stay terminal', () => {
    // Closed Won (+25) is the one award with no once-only guard, so re-entry
    // must remain impossible.
    expect(isValidTransition('closed', 'closed')).toBe(false);
    expect(isValidTransition('lost', 'lost')).toBe(false);
  });

  it('unlocks the ≥6-attempt Lost reason, which was previously unreachable', () => {
    expect(isValidTransition('attempted_contact', 'attempted_contact')).toBe(true);
    expect(lostReasonsForOrigin('attempted_contact', ATTEMPTED_CONTACTS_FOR_LOST)).toContain(
      'no_response_after_6',
    );
  });
});

describe('v4 Lost reasons by origin', () => {
  it('Attempted Contact: Lost A immediate, A2 gated at 6 attempts', () => {
    expect(lostReasonsForOrigin('attempted_contact', 0)).toEqual([
      'bad_number',
      'wrong_number',
      'email_bounced',
    ]);
    expect(lostReasonsForOrigin('attempted_contact', ATTEMPTED_CONTACTS_FOR_LOST)).toContain(
      'no_response_after_6',
    );
    expect(lostReasonsForOrigin('attempted_contact', 5)).not.toContain('no_response_after_6');
  });

  it('Connected -> Lost B, Nurturing/Appt -> Lost C, Signed -> Lost D', () => {
    expect(lostReasonsForOrigin('connected')).toEqual([
      'already_listed_or_sold',
      'just_looking',
      'already_have_agent',
    ]);
    expect(lostReasonsForOrigin('nurturing')).toEqual(lostReasonsForOrigin('appointment_set'));
    expect(lostReasonsForOrigin('nurturing')).toContain('stopped_responding');
    expect(lostReasonsForOrigin('signed')).toEqual([
      'listing_withdrawn',
      'listing_expired',
      'terminated_for_another_agent',
    ]);
  });

  it('validates a reason against its origin', () => {
    expect(isValidLostReasonForOrigin('connected', 'just_looking')).toBe(true);
    expect(isValidLostReasonForOrigin('connected', 'listing_expired')).toBe(false); // Lost D, wrong origin
    expect(isValidLostReasonForOrigin('attempted_contact', 'no_response_after_6', 6)).toBe(true);
    expect(isValidLostReasonForOrigin('attempted_contact', 'no_response_after_6', 3)).toBe(false);
    expect(isValidLostReasonForOrigin('new', 'bad_number')).toBe(false); // Lost not reachable from New
  });

  it('labels statuses and reasons', () => {
    expect(leadStatusLabel('appointment_set')).toBe('Appointment set');
    expect(leadStatusLabel('signed')).toBe('Signed');
    expect(v4LostReasonLabel('already_listed_or_sold')).toBe('Already listed / recently sold');
    expect(v4LostReasonLabel('no_response_after_6')).toBe('No response after 6 attempts');
  });
});
