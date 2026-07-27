import { describe, it, expect } from 'vitest';
import { decideEngagement, parseRepresentation } from '../lib/buyerEngagement';

describe('decideEngagement', () => {
  const lead = { id: 1 };

  it('attaches whenever an active lead already exists (regardless of representation)', () => {
    expect(decideEngagement(lead, undefined)).toBe('attach');
    expect(decideEngagement(lead, { kind: 'none' })).toBe('attach');
    expect(decideEngagement(lead, { kind: 'our_agent' })).toBe('attach');
    expect(decideEngagement(lead, { kind: 'other_brokerage' })).toBe('attach');
  });

  it('routes a brand-new unrepresented buyer', () => {
    expect(decideEngagement(null, { kind: 'none' })).toBe('route');
    expect(decideEngagement(null, undefined)).toBe('route');
  });

  it('direct-assigns when the buyer claims one of our agents', () => {
    expect(decideEngagement(null, { kind: 'our_agent', claimedAgentId: 5 })).toBe('assign-claimed');
    expect(decideEngagement(null, { kind: 'our_agent', claimedAgentName: 'Mike' })).toBe('assign-claimed');
  });

  it('suppresses (no lead) when the buyer is represented by another brokerage', () => {
    expect(decideEngagement(null, { kind: 'other_brokerage' })).toBe('suppress');
  });
});

describe('parseRepresentation', () => {
  it('parses each kind, dropping unknowns', () => {
    expect(parseRepresentation({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(parseRepresentation({ kind: 'other_brokerage' })).toEqual({ kind: 'other_brokerage' });
    expect(parseRepresentation({ kind: 'our_agent', claimedAgentId: 7 })).toEqual({
      kind: 'our_agent',
      claimedAgentId: 7,
      claimedAgentName: null,
    });
    expect(parseRepresentation({ kind: 'our_agent', claimedAgentName: '  Mike  ' })).toEqual({
      kind: 'our_agent',
      claimedAgentId: null,
      claimedAgentName: 'Mike',
    });
  });

  it('returns undefined for garbage', () => {
    expect(parseRepresentation(null)).toBeUndefined();
    expect(parseRepresentation({ kind: 'nope' })).toBeUndefined();
    expect(parseRepresentation('none')).toBeUndefined();
  });
});
