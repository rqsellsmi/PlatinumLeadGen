import { describe, it, expect } from 'vitest';
import { SCORE_DELTAS, resolveScoreDelta, SCORE_MIN, SCORE_MAX } from '../lib/scoring';
import { scoreTier, scoreReasonLabel } from '../lib/scoreTiers';
import {
  parseMoney,
  parsePercentOfList,
  parseCloseDate,
  parseClosingsCsv,
} from '../lib/csvClosings';
import {
  calcPctAboveList,
  calcAvgSalePrice,
  calcAvgDaysToSell,
  calcAvgPercentOfList,
} from '../lib/metrics';
import type { Closing } from '../drizzle/schema';

describe('scoring corrections (§E/§J)', () => {
  it('uses the corrected fixed deltas', () => {
    expect(SCORE_DELTAS.system_response_fast).toBe(10.0);
    expect(SCORE_DELTAS.system_response_good).toBe(5.0);
    expect(SCORE_DELTAS.system_response_slow).toBe(2.0);
    expect(SCORE_DELTAS.system_decline).toBe(-3.0);
    expect(SCORE_DELTAS.system_no_response).toBe(-1.5);
    expect(SCORE_DELTAS.stale_48h).toBe(-1.0);
    expect(SCORE_DELTAS.stale_7day).toBe(-1.0);
  });

  it('allows an explicit delta override (15–30 min tier = +7.65)', () => {
    expect(resolveScoreDelta('system_response_fast', 7.65)).toBe(7.65);
    expect(resolveScoreDelta('system_response_fast')).toBe(10.0);
  });

  it('requires an explicit delta for reversals and manual adjustments', () => {
    expect(() => resolveScoreDelta('lead_deleted_reversal')).toThrow();
    expect(() => resolveScoreDelta('manual_adjustment')).toThrow();
    expect(resolveScoreDelta('lead_deleted_reversal', 1.5)).toBe(1.5);
  });

  it('exposes the [0,200] clamp bounds', () => {
    expect(SCORE_MIN).toBe(0);
    expect(SCORE_MAX).toBe(200);
  });
});

describe('score tiers (§K.8)', () => {
  it('maps scores to the exact tier labels', () => {
    expect(scoreTier(120).label).toBe('Top Performer');
    expect(scoreTier(100).label).toBe('Top Performer');
    expect(scoreTier(80).label).toBe('Strong');
    expect(scoreTier(60).label).toBe('Good Standing');
    expect(scoreTier(40).label).toBe('Average');
    expect(scoreTier(20).label).toBe('Needs Improvement');
    expect(scoreTier(0).label).toBe('At Risk');
    expect(scoreTier(50).label).toBe('Average');
  });
  it('has human-readable reason labels', () => {
    expect(scoreReasonLabel('system_decline')).toBe('Declined lead');
    expect(scoreReasonLabel('stale_48h')).toBe('No update (48h)');
  });
});

describe('CSV parsing (§A.3)', () => {
  it('strips $ and commas from money', () => {
    expect(parseMoney('$1,250,000')).toBe(1250000);
    expect(parseMoney('320000')).toBe(320000);
    expect(parseMoney('')).toBeNull();
  });

  it('handles decimal and percentage list ratios', () => {
    expect(parsePercentOfList('0.985')).toBe(98.5); // decimal → ×100
    expect(parsePercentOfList('103.5')).toBe(103.5); // already a percentage
    expect(parsePercentOfList('98%')).toBe(98);
    expect(parsePercentOfList('')).toBeNull();
  });

  it('parses multiple date formats', () => {
    expect(parseCloseDate('2025-06-15')?.getUTCFullYear()).toBe(2025);
    expect(parseCloseDate('6/15/2025')?.getUTCMonth()).toBe(5);
    expect(parseCloseDate('January 15, 2025')?.getFullYear()).toBe(2025);
    expect(parseCloseDate('not a date')).toBeNull();
  });

  it('maps aliased headers, dedups happen later, skips bad rows', () => {
    const csv = [
      'MLS,Close Date,List Price,Close Price,DOM,Address,City,School District,RATIO Close Price By List Price',
      'A1,2025-03-01,"$300,000","$310,000",12,123 Main St,Brighton,Brighton Area Schools,1.033',
      'A2,,"$300,000","$310,000",12,456 Oak St,Brighton,Brighton Area Schools,0.98', // bad date → skipped
    ].join('\n');
    const { rows, errors } = parseClosingsCsv(csv, 'listing');
    expect(rows).toHaveLength(1);
    expect(rows[0].mlsNumber).toBe('A1');
    expect(rows[0].salePrice).toBe(310000);
    expect(rows[0].listPrice).toBe(300000);
    expect(rows[0].schoolDistrict).toBe('Brighton Area Schools');
    expect(Math.round(rows[0].percentOfListPrice ?? 0)).toBe(103);
    expect(errors.length).toBe(1);
  });
});

describe('metrics calcs (§A.4)', () => {
  const mk = (over: Partial<Closing>): Closing =>
    ({
      id: 1,
      mlsNumber: null,
      agentRole: 'listing',
      closeDate: new Date('2025-05-01'),
      listPrice: 100000,
      salePrice: 100000,
      daysOnMarket: 10,
      address: 'x',
      city: null,
      state: 'MI',
      zipCode: null,
      propertyType: 'Single Family',
      agentName: null,
      schoolDistrict: null,
      percentOfListPrice: 100,
      uploadBatchId: 1,
      createdAt: new Date(),
      ...over,
    }) as Closing;

  it('computes % above list over valid rows', () => {
    const rows = [
      mk({ listPrice: 100000, salePrice: 110000 }),
      mk({ listPrice: 100000, salePrice: 90000 }),
      mk({ listPrice: 100000, salePrice: 105000 }),
    ];
    expect(calcPctAboveList(rows)).toBe(67); // 2 of 3
    expect(calcPctAboveList([])).toBe(0);
  });

  it('computes averages, ignoring zero/null where required', () => {
    const rows = [mk({ salePrice: 200000, daysOnMarket: 20, percentOfListPrice: 98 }), mk({ salePrice: 400000, daysOnMarket: 0, percentOfListPrice: 0 })];
    expect(calcAvgSalePrice(rows)).toBe(300000);
    expect(calcAvgDaysToSell(rows)).toBe(20); // ignores dom=0
    expect(calcAvgPercentOfList(rows)).toBe(98); // ignores pct=0
  });
});
