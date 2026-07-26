import { describe, it, expect } from 'vitest';
import { humanizeEnum } from '../lib/prettyEnum';

describe('humanizeEnum', () => {
  it('splits PascalCase RESO tokens', () => {
    expect(humanizeEnum('SingleFamilyResidence')).toBe('Single Family Residence');
    expect(humanizeEnum('WalkOutAccess')).toBe('Walk Out Access');
    expect(humanizeEnum('LakeFenton')).toBe('Lake Fenton');
    expect(humanizeEnum('MultiFamily')).toBe('Multi Family');
    expect(humanizeEnum('UnimprovedLand')).toBe('Unimproved Land');
  });

  it('humanizes each item in a comma list', () => {
    expect(humanizeEnum('Finished, WalkOutAccess')).toBe('Finished, Walk Out Access');
  });

  it('preserves non-comma separators and mixed content', () => {
    expect(humanizeEnum('LakeFenton · All Sports Lake')).toBe('Lake Fenton · All Sports Lake');
  });

  it('is a no-op on already-spaced, numeric, and currency values', () => {
    expect(humanizeEnum('Forced Air, Natural Gas')).toBe('Forced Air, Natural Gas');
    expect(humanizeEnum('0.1 acres · 37x116x45x111')).toBe('0.1 acres · 37x116x45x111');
    expect(humanizeEnum('$12,655')).toBe('$12,655');
    expect(humanizeEnum('2 · attached')).toBe('2 · attached');
  });

  it('handles blank / null', () => {
    expect(humanizeEnum('')).toBe('');
    expect(humanizeEnum(null)).toBe('');
    expect(humanizeEnum(undefined)).toBe('');
  });
});
