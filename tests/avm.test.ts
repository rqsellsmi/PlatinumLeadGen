import { describe, it, expect } from 'vitest';
import {
  parseBasement,
  makeDriverSet,
  adjustComp,
  reconcile,
  hardFilterReason,
  propertyFamily,
  statusReliability,
  DEFAULT_COEFFICIENTS,
  type DriverInput,
  type DriverSet,
  type ReconInput,
} from '../lib/avm/engine';
import { sameProperty } from '../lib/avm/addressMatch';

const baseInput: DriverInput = {
  sqft: null,
  beds: null,
  baths: null,
  garageSpaces: null,
  acreage: null,
  waterfront: null,
  frontageFeet: null,
  basement: null,
  pool: null,
  yearBuilt: null,
};

describe('parseBasement', () => {
  it('detects finished / walkout / egress from the RESO enum list', () => {
    const b = parseBasement('Finished, Walk-Out Access, Egress Window(s)');
    expect(b).toEqual({ known: true, finished: true, walkout: true, egress: true });
  });
  it('does not read "Unfinished" as finished', () => {
    const b = parseBasement('Unfinished, Full');
    expect(b.finished).toBe(false);
    expect(b.known).toBe(true);
  });
  it('is unknown when the field is empty', () => {
    expect(parseBasement(null).known).toBe(false);
    expect(parseBasement('   ').known).toBe(false);
  });
});

describe('adjustComp', () => {
  it('raises a comp that is smaller/lesser than the subject and lowers a larger one', () => {
    const subject = makeDriverSet({ ...baseInput, sqft: 2000, beds: 4, garageSpaces: 3 });
    const comp = makeDriverSet({ ...baseInput, sqft: 1800, beds: 3, garageSpaces: 2 });
    const r = adjustComp(subject, comp, 400_000);
    // +200 sqft*$100 + 1 bed*$5k + 1 bay*$8k = +$33k
    expect(r.adjustedPrice).toBe(433_000);
    expect(r.totalAdjustment).toBe(33_000);
    expect(r.lineItems).toHaveLength(3);
  });

  it('prices water frontage only when both homes are waterfront', () => {
    const subject = makeDriverSet({ ...baseInput, waterfront: true, frontageFeet: 100 });
    const wfComp = makeDriverSet({ ...baseInput, waterfront: true, frontageFeet: 60 });
    const offComp = makeDriverSet({ ...baseInput, waterfront: false, frontageFeet: 0 });
    // +40 ft * $3,000 = +$120k
    expect(adjustComp(subject, wfComp, 500_000).adjustedPrice).toBe(620_000);
    // off-water comp: frontage line does not fire (filter handles on/off upstream)
    expect(adjustComp(subject, offComp, 500_000).lineItems.some((l) => l.driver === 'Water frontage')).toBe(false);
  });

  it('never fabricates an adjustment when a datum is missing on either side', () => {
    const subject = makeDriverSet({ ...baseInput, sqft: 2000 });
    const comp = makeDriverSet({ ...baseInput, sqft: null, beds: 3 });
    const r = adjustComp(subject, comp, 300_000);
    expect(r.lineItems).toHaveLength(0);
    expect(r.adjustedPrice).toBe(300_000);
  });

  it('prices a finished walkout with egress from the basement enum', () => {
    const subject = makeDriverSet({ ...baseInput, basement: 'Finished, Walk-Out Access, Egress Window(s)' });
    const comp = makeDriverSet({ ...baseInput, basement: 'Unfinished' });
    const r = adjustComp(subject, comp, 250_000);
    // finished 20k + walkout 15k + egress 3k = +38k
    expect(r.adjustedPrice).toBe(288_000);
  });
});

describe('reconcile', () => {
  const mk = (adjustedPrice: number, similarity: number, totalAdjustment = 0, withinRadius = true): ReconInput => ({
    adjustedPrice,
    rawPrice: adjustedPrice,
    similarity,
    totalAdjustment,
    withinRadius,
  });

  it('returns a null value with no comps', () => {
    const r = reconcile([]);
    expect(r.value).toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('weights closer (lower-similarity) comps more heavily', () => {
    const r = reconcile([mk(500_000, 0.1), mk(400_000, 5)]);
    // The near comp (500k) dominates, so the value sits well above the midpoint.
    expect(r.value).toBeGreaterThan(460_000);
    expect(r.compsUsed).toBe(2);
  });

  it('gives high confidence for many tight, low-adjustment nearby comps', () => {
    const tight = [500_000, 505_000, 498_000, 502_000, 500_000].map((p) => mk(p, 0.5, 5_000));
    expect(reconcile(tight).confidence).toBe('high');
  });

  it('gives low confidence for few, widely-dispersed comps', () => {
    const wide = [reconcileInput(400_000), reconcileInput(700_000)];
    expect(reconcile(wide).confidence).toBe('low');
  });

  it('weights a closed comp above an active one at the same distance/similarity', () => {
    const closed: ReconInput = { adjustedPrice: 500_000, rawPrice: 500_000, similarity: 1, totalAdjustment: 0, withinRadius: true, statusWeight: 1 };
    const active: ReconInput = { adjustedPrice: 600_000, rawPrice: 600_000, similarity: 1, totalAdjustment: 0, withinRadius: true, statusWeight: 0.6 };
    // The closed comp (1.0) outweighs the active (0.6), so the value sits below the
    // 550k midpoint (pulled toward the closed 500k).
    expect(reconcile([closed, active]).value!).toBeLessThan(550_000);
  });
});

describe('statusReliability', () => {
  it('ranks Closed > Pending/UC > Active', () => {
    expect(statusReliability('Closed')).toBeGreaterThan(statusReliability('Pending'));
    expect(statusReliability('Pending')).toBe(statusReliability('ActiveUnderContract'));
    expect(statusReliability('ActiveUnderContract')).toBeGreaterThan(statusReliability('Active'));
  });
});

function reconcileInput(p: number): ReconInput {
  return { adjustedPrice: p, rawPrice: p, similarity: 1, totalAdjustment: 0, withinRadius: true };
}

describe('hardFilterReason', () => {
  it('rejects an off-water comp for a waterfront subject', () => {
    expect(hardFilterReason(true, 'single', false, 'single')).toMatch(/off-water/);
  });
  it('rejects a waterfront comp for a non-waterfront subject', () => {
    expect(hardFilterReason(false, 'single', true, 'single')).toMatch(/waterfront/);
  });
  it('rejects a different property family', () => {
    expect(hardFilterReason(false, 'single', false, 'condo')).toMatch(/different property type/);
  });
  it('passes a matching comp', () => {
    expect(hardFilterReason(true, 'single', true, 'single')).toBeNull();
  });
});

describe('propertyFamily', () => {
  it('buckets single-family and condo', () => {
    expect(propertyFamily('Single Family Residence')).toBe('single');
    expect(propertyFamily('Condominium')).toBe('condo');
  });
});

describe('sameProperty (address matching)', () => {
  it('matches the same home when the city name differs (Google vs MLS)', () => {
    // The exact case that broke the backtest: autocomplete city vs MLS city.
    expect(
      sameProperty(
        '5915 Chickadee Ln, Village of Clarkston, MI 48346, USA',
        '5915 Chickadee Ln, Clarkston, MI 48346',
      ),
    ).toBe(true);
  });
  it('matches across a missing/extra street suffix at the same number+zip', () => {
    expect(sameProperty('5915 Chickadee Ln, Clarkston, MI 48346', '5915 Chickadee, Clarkston, MI 48346')).toBe(true);
  });
  it('rejects a different house number', () => {
    expect(sameProperty('5917 Chickadee Ln, Clarkston, MI 48346', '5915 Chickadee Ln, Clarkston, MI 48346')).toBe(false);
  });
  it('rejects the same street text in a different ZIP', () => {
    expect(sameProperty('100 Main St, Brighton, MI 48116', '100 Main St, Fenton, MI 48430')).toBe(false);
  });
  it('rejects a different street at the same number+zip', () => {
    expect(sameProperty('100 Oak St, Clarkston, MI 48346', '100 Elm St, Clarkston, MI 48346')).toBe(false);
  });
  it('is false for empty input', () => {
    expect(sameProperty(null, '5915 Chickadee Ln, Clarkston, MI 48346')).toBe(false);
  });
});
