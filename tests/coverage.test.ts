/**
 * Coverage rules (P0.4, review #76, decision D22).
 *
 * The load-bearing case is `unknown`: propertyState is NULL for every
 * organically-submitted lead today, so an out-of-state gate that treats "no
 * state" as "out of state" would route the entire funnel to the admin.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PROXIMITY_RADIUS_MILES,
  clampProximityRadius,
  isUnusuallyBroadRadius,
  deriveCityFromAddress,
  normalizeStateCode,
  decideCoverage,
  deriveStateFromAddress,
} from '../lib/coverage';

describe('clampProximityRadius', () => {
  it('passes through a sane radius', () => {
    expect(clampProximityRadius(20)).toBe(20);
    expect(clampProximityRadius('45')).toBe(45);
  });

  it('caps the live 1000-mile setting at 250', () => {
    expect(clampProximityRadius(1000)).toBe(MAX_PROXIMITY_RADIUS_MILES);
  });

  it('allows exactly the maximum', () => {
    expect(clampProximityRadius(250)).toBe(250);
  });

  it('rejects Infinity — the admin editor used to persist it', () => {
    // `num()` in the admin action only guarded NaN; Infinity is > 0 and not
    // NaN, so it passed straight through as an unbounded radius.
    expect(clampProximityRadius(Infinity)).toBeNull();
    expect(clampProximityRadius('Infinity')).toBeNull();
  });

  it('treats zero, negatives and junk as "not set"', () => {
    expect(clampProximityRadius(0)).toBeNull();
    expect(clampProximityRadius(-5)).toBeNull();
    expect(clampProximityRadius(NaN)).toBeNull();
    expect(clampProximityRadius('')).toBeNull();
    expect(clampProximityRadius('abc')).toBeNull();
    expect(clampProximityRadius(null)).toBeNull();
  });
});

describe('isUnusuallyBroadRadius', () => {
  it('warns above the threshold, not at or below it', () => {
    expect(isUnusuallyBroadRadius(101)).toBe(true);
    expect(isUnusuallyBroadRadius(250)).toBe(true);
    expect(isUnusuallyBroadRadius(100)).toBe(false);
    expect(isUnusuallyBroadRadius(20)).toBe(false);
    expect(isUnusuallyBroadRadius(null)).toBe(false);
  });
});

describe('normalizeStateCode', () => {
  it('normalises codes and known names', () => {
    expect(normalizeStateCode('mi')).toBe('MI');
    expect(normalizeStateCode(' MI ')).toBe('MI');
    expect(normalizeStateCode('Michigan')).toBe('MI');
    expect(normalizeStateCode('Ohio')).toBe('OH');
  });

  it('returns null for anything unrecognised rather than guessing', () => {
    expect(normalizeStateCode('')).toBeNull();
    expect(normalizeStateCode(null)).toBeNull();
    expect(normalizeStateCode('Michigann')).toBeNull();
    expect(normalizeStateCode('USA')).toBeNull();
  });
});

describe('deriveStateFromAddress', () => {
  it('reads the state out of a Google-formatted address', () => {
    expect(deriveStateFromAddress('123 Main St, Brighton, MI 48116, USA')).toBe('MI');
    expect(deriveStateFromAddress('9 Elm Ave, Toledo, OH 43604, USA')).toBe('OH');
    expect(deriveStateFromAddress('1 A St, Reno, NV 89501-1234')).toBe('NV');
  });

  it('handles an address with no ZIP', () => {
    expect(deriveStateFromAddress('123 Main St, Brighton, MI, USA')).toBe('MI');
  });

  it('reads a looser, manually-typed address with no comma before the state', () => {
    // The manual/LSA entry path (D22) — a human types "500 Oak, Cleveland OH
    // 44101" with no comma separating city and state. Issue #2b.
    expect(deriveStateFromAddress('500 Oak, Cleveland OH 44101')).toBe('OH');
    expect(deriveStateFromAddress('42 Birch Ln Ann Arbor MI 48104')).toBe('MI');
  });

  it('reads a full state name at the tail', () => {
    expect(deriveStateFromAddress('123 Main St, Brighton, Michigan')).toBe('MI');
  });

  it('does not mistake a street abbreviation for a state', () => {
    // "St" precedes a ZIP-shaped token nowhere here, but a bare two-letter run
    // must never win: only real state codes count.
    expect(deriveStateFromAddress('12 St Clair Ave, Somewhere ZZ 00000')).toBeNull();
  });

  it('returns null when it cannot parse confidently', () => {
    expect(deriveStateFromAddress('123 Main St')).toBeNull();
    expect(deriveStateFromAddress('')).toBeNull();
    expect(deriveStateFromAddress(null)).toBeNull();
    expect(deriveStateFromAddress('Brighton')).toBeNull();
  });
});

describe('decideCoverage', () => {
  it('routes a Michigan property normally', () => {
    expect(decideCoverage({ propertyState: 'MI' })).toEqual({ kind: 'in_state' });
  });

  it('gates an out-of-state property', () => {
    expect(decideCoverage({ propertyState: 'OH' })).toEqual({ kind: 'out_of_state', state: 'OH' });
  });

  it('falls back to the address when propertyState is NULL', () => {
    // This is the real-world path: propertyState is NULL for every organic
    // lead, so the formatted address is the only signal available.
    expect(
      decideCoverage({ propertyState: null, propertyAddress: '9 Elm Ave, Toledo, OH 43604, USA' }),
    ).toEqual({ kind: 'out_of_state', state: 'OH' });
    expect(
      decideCoverage({ propertyState: null, propertyAddress: '1 Main St, Brighton, MI 48116, USA' }),
    ).toEqual({ kind: 'in_state' });
  });

  it('prefers an explicit state over the parsed address', () => {
    expect(
      decideCoverage({ propertyState: 'MI', propertyAddress: '9 Elm Ave, Toledo, OH 43604' }),
    ).toEqual({ kind: 'in_state' });
  });

  it('returns UNKNOWN when the state cannot be determined — never guesses', () => {
    // Critical: unknown must route normally. Treating it as out-of-state would
    // send every lead whose address did not parse to the admin.
    expect(decideCoverage({})).toEqual({ kind: 'unknown' });
    expect(decideCoverage({ propertyState: null, propertyAddress: '123 Main St' })).toEqual({
      kind: 'unknown',
    });
    expect(decideCoverage({ propertyState: '', propertyAddress: '' })).toEqual({ kind: 'unknown' });
  });
});

/**
 * City-without-street, for lead offers. An unaccepted offer must not carry
 * anything that locates the seller, but "no location at all" is not enough for
 * an agent to judge whether to take the lead.
 */
describe('deriveCityFromAddress', () => {
  it('pulls the city out of a Google-formatted address', () => {
    expect(deriveCityFromAddress('123 Main St, Brighton, MI 48116, USA')).toBe('Brighton');
    expect(deriveCityFromAddress('123 Main St, Brighton, MI 48116')).toBe('Brighton');
  });

  it('is not thrown off by a unit number or a multi-word city', () => {
    expect(deriveCityFromAddress('123 Main St #4, Ann Arbor, MI 48104, USA')).toBe('Ann Arbor');
    expect(deriveCityFromAddress('9 Oak Ln Apt 2B, Whitmore Lake, MI 48189')).toBe('Whitmore Lake');
  });

  it('handles an address with no ZIP', () => {
    expect(deriveCityFromAddress('9 Oak Ln, Fenton, MI')).toBe('Fenton');
    expect(deriveCityFromAddress('9 Oak Ln, Fenton, MI, USA')).toBe('Fenton');
  });

  it('NEVER returns anything containing a house number', () => {
    // No city part at all — must yield null rather than the street line.
    expect(deriveCityFromAddress('123 Main St, MI 48116')).toBeNull();
    expect(deriveCityFromAddress('123 Main St, MI')).toBeNull();
  });

  it('returns null rather than guessing', () => {
    expect(deriveCityFromAddress(null)).toBeNull();
    expect(deriveCityFromAddress('')).toBeNull();
    expect(deriveCityFromAddress('Brighton')).toBeNull();
    expect(deriveCityFromAddress('123 Main St, Brighton, XX 48116')).toBeNull(); // not a real state
  });
});
