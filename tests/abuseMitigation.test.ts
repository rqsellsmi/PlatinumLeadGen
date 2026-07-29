/**
 * P0.3 abuse-mitigation tests (review #11, decision D5 MODIFIED).
 *
 * The important assertions here are the ones that prove we DON'T reject real
 * traffic. A false positive on a public seller form silently discards a lead
 * that Google Ads was paid for, which is a worse outcome than letting spam
 * through — so every "missing signal" case must come back `accept`.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateAbuseSignals,
  exceedsPayloadLimit,
  MIN_COMPLETION_MS,
  MAX_PUBLIC_BODY_BYTES,
} from '../lib/abuseMitigation';

const NOW = 1_800_000_000_000;

describe('evaluateAbuseSignals — honeypot', () => {
  it('rejects a filled honeypot (no innocent explanation)', () => {
    expect(evaluateAbuseSignals({ honeypot: 'Acme Corp', now: NOW })).toEqual({
      action: 'reject',
      reason: 'honeypot',
    });
  });

  it('accepts an empty or whitespace honeypot', () => {
    expect(evaluateAbuseSignals({ honeypot: '', now: NOW }).action).toBe('accept');
    expect(evaluateAbuseSignals({ honeypot: '   ', now: NOW }).action).toBe('accept');
  });

  it('accepts a missing honeypot — an old cached page has no such field', () => {
    expect(evaluateAbuseSignals({ now: NOW }).action).toBe('accept');
    expect(evaluateAbuseSignals({ honeypot: null, now: NOW }).action).toBe('accept');
  });
});

describe('evaluateAbuseSignals — minimum completion time', () => {
  it('flags (never rejects) an implausibly fast completion', () => {
    const v = evaluateAbuseSignals({ formLoadedAt: NOW - 100, now: NOW });
    expect(v).toEqual({ action: 'flag', reason: 'too_fast' });
  });

  it('accepts a completion at or beyond the threshold', () => {
    expect(evaluateAbuseSignals({ formLoadedAt: NOW - MIN_COMPLETION_MS, now: NOW }).action).toBe(
      'accept',
    );
    expect(evaluateAbuseSignals({ formLoadedAt: NOW - 45_000, now: NOW }).action).toBe('accept');
  });

  it('accepts a missing timestamp rather than penalising a stripped field', () => {
    expect(evaluateAbuseSignals({ now: NOW }).action).toBe('accept');
    expect(evaluateAbuseSignals({ formLoadedAt: null, now: NOW }).action).toBe('accept');
    expect(evaluateAbuseSignals({ formLoadedAt: 0, now: NOW }).action).toBe('accept');
  });

  it('ignores a skewed client clock instead of blaming the user', () => {
    // A timestamp in the future means the visitor's clock is wrong, not that
    // they are a bot. The signal is unusable, so it is discarded.
    expect(evaluateAbuseSignals({ formLoadedAt: NOW + 60_000, now: NOW }).action).toBe('accept');
  });

  it('ignores NaN and Infinity', () => {
    expect(evaluateAbuseSignals({ formLoadedAt: NaN, now: NOW }).action).toBe('accept');
    expect(evaluateAbuseSignals({ formLoadedAt: Infinity, now: NOW }).action).toBe('accept');
  });
});

describe('evaluateAbuseSignals — precedence', () => {
  it('the honeypot outranks the timing signal', () => {
    const v = evaluateAbuseSignals({ honeypot: 'bot', formLoadedAt: NOW - 100, now: NOW });
    expect(v).toEqual({ action: 'reject', reason: 'honeypot' });
  });

  it('a clean submission with both signals present is accepted', () => {
    expect(
      evaluateAbuseSignals({ honeypot: '', formLoadedAt: NOW - 30_000, now: NOW }).action,
    ).toBe('accept');
  });
});

describe('exceedsPayloadLimit', () => {
  it('rejects an oversized advertised body', () => {
    expect(exceedsPayloadLimit(String(MAX_PUBLIC_BODY_BYTES + 1), MAX_PUBLIC_BODY_BYTES)).toBe(true);
  });

  it('allows a body at exactly the limit', () => {
    expect(exceedsPayloadLimit(String(MAX_PUBLIC_BODY_BYTES), MAX_PUBLIC_BODY_BYTES)).toBe(false);
  });

  it('allows a missing or unparseable content-length (it is advisory)', () => {
    expect(exceedsPayloadLimit(null, MAX_PUBLIC_BODY_BYTES)).toBe(false);
    expect(exceedsPayloadLimit('', MAX_PUBLIC_BODY_BYTES)).toBe(false);
    expect(exceedsPayloadLimit('not-a-number', MAX_PUBLIC_BODY_BYTES)).toBe(false);
  });
});
