import { describe, it, expect } from 'vitest';
import { LEAD_INTENTS, isLeadIntent, leadIntentLabel, leadIntentTone } from '../lib/leadIntent';

describe('leadIntent (buyer/seller classification)', () => {
  it('has exactly the three classifications', () => {
    expect(LEAD_INTENTS).toEqual(['seller', 'buyer', 'unknown']);
  });

  it('validates values', () => {
    expect(isLeadIntent('seller')).toBe(true);
    expect(isLeadIntent('buyer')).toBe(true);
    expect(isLeadIntent('unknown')).toBe(true);
    expect(isLeadIntent('agent')).toBe(false);
    expect(isLeadIntent('')).toBe(false);
    expect(isLeadIntent(null)).toBe(false);
    expect(isLeadIntent(3)).toBe(false);
  });

  it('labels each value, passing unknown strings through', () => {
    expect(leadIntentLabel('seller')).toBe('Seller');
    expect(leadIntentLabel('buyer')).toBe('Buyer');
    expect(leadIntentLabel('unknown')).toBe('Unknown');
    expect(leadIntentLabel('weird')).toBe('weird');
  });

  it('maps each value to a valid pill tone', () => {
    expect(leadIntentTone('seller')).toBe('info');
    expect(leadIntentTone('buyer')).toBe('purple');
    expect(leadIntentTone('unknown')).toBe('neutral');
    expect(leadIntentTone('weird')).toBe('neutral');
  });
});
