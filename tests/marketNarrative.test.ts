import { describe, it, expect } from 'vitest';
import { stripDashes, fallbackNarrative } from '../lib/marketNarrative';
import type { CityMarketReport } from '../lib/idx';

const DASH = /[—–―]/; // em, en, horizontal bar

const sample: CityMarketReport = {
  city: 'Brighton',
  periodLabel: 'Q2 2026',
  medianSalePrice: 438000,
  yoyChangePct: 6.4,
  medianPricePerSqft: 214,
  avgDaysOnMarket: 18,
  listToSaleRatio: 99.2,
  homesSold90d: 147,
  soldAboveAskingPct: 34,
  monthsOfInventory: 1.8,
  activeListings: 88,
  trailing: [],
  trailing12ChangeAbs: 26000,
};

describe('stripDashes', () => {
  it('removes em and en dashes', () => {
    expect(stripDashes('a strong market — priced well')).not.toMatch(DASH);
    expect(stripDashes('range 400–470')).not.toMatch(DASH);
    expect(stripDashes('a — b – c')).not.toMatch(DASH);
  });
});

describe('fallbackNarrative', () => {
  it('produces a human summary with no em/en dashes', () => {
    const text = fallbackNarrative('Brighton', sample);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(DASH);
    expect(text).toContain('Brighton');
  });

  it('handles sparse data without dashes or crashes', () => {
    const sparse: CityMarketReport = {
      ...sample,
      medianSalePrice: null,
      yoyChangePct: null,
      medianPricePerSqft: null,
      avgDaysOnMarket: null,
      listToSaleRatio: null,
      soldAboveAskingPct: null,
      monthsOfInventory: null,
    };
    const text = fallbackNarrative('Howell', sparse);
    expect(text).not.toMatch(DASH);
    expect(text.length).toBeGreaterThan(0);
  });
});
