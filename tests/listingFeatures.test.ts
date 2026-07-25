import { describe, it, expect } from 'vitest';
import { buildKeyFeatures } from '../lib/listingFeatures';

// Minimal partial listing; only the fields buildKeyFeatures reads matter.
function make(overrides: Record<string, unknown> = {}) {
  return {
    waterfrontYN: null,
    waterBodyName: null,
    waterFrontageFeet: null,
    waterfrontFeatures: null,
    lotSizeAcres: null,
    newConstructionYN: null,
    poolPrivateYN: null,
    garageSpaces: null,
    attachedGarageYN: null,
    fireplacesTotal: null,
    fireplaceFeatures: null,
    basement: null,
    yearBuilt: null,
    associationYN: null,
    associationFee: null,
    view: null,
    bedsTotal: null,
    ...overrides,
  } as any;
}

describe('buildKeyFeatures', () => {
  it('leads with the lake name for waterfront and adds frontage', () => {
    const f = buildKeyFeatures(make({ waterfrontYN: true, waterBodyName: 'Lake Fenton', waterFrontageFeet: 120 }));
    expect(f[0]).toEqual({ icon: 'water', label: 'On Lake Fenton' });
    expect(f.map((x) => x.label)).toContain('120 ft of frontage');
  });

  it('falls back to Waterfront when no body/frontage', () => {
    const f = buildKeyFeatures(make({ waterfrontYN: true }));
    expect(f[0].label).toBe('Waterfront');
  });

  it('picks non-waterfront standouts from populated fields only', () => {
    const f = buildKeyFeatures(
      make({
        lotSizeAcres: 2.4,
        newConstructionYN: true,
        poolPrivateYN: true,
        garageSpaces: 3,
        attachedGarageYN: true,
        fireplacesTotal: 2,
        basement: 'Finished, Walkout',
        yearBuilt: 2021,
      }),
    );
    const labels = f.map((x) => x.label);
    expect(labels).toContain('2.4 acres');
    expect(labels).toContain('New construction');
    expect(labels).toContain('Private pool');
    expect(labels).toContain('3-car garage (attached)');
    expect(labels).toContain('2 fireplaces');
    expect(labels).toContain('Finished basement');
  });

  it('detects a gas fireplace from features', () => {
    const f = buildKeyFeatures(make({ fireplaceFeatures: 'Gas, Living Room' }));
    expect(f.map((x) => x.label)).toContain('Gas fireplace');
  });

  it('ignores tiny lots and skips No-HOA unless explicitly false', () => {
    const small = buildKeyFeatures(make({ lotSizeAcres: 0.2 }));
    expect(small.map((x) => x.label)).not.toContain('0.2 acres');
    expect(buildKeyFeatures(make({ associationYN: false })).map((x) => x.label)).toContain('No HOA');
    expect(buildKeyFeatures(make({ associationYN: true })).map((x) => x.label)).not.toContain('No HOA');
  });

  it('caps the number of chips', () => {
    const f = buildKeyFeatures(
      make({
        waterfrontYN: true,
        waterBodyName: 'Lake X',
        waterFrontageFeet: 100,
        lotSizeAcres: 3,
        newConstructionYN: true,
        poolPrivateYN: true,
        garageSpaces: 4,
        fireplacesTotal: 2,
        basement: 'Finished',
        yearBuilt: 2020,
      }),
      4,
    );
    expect(f.length).toBeLessThanOrEqual(4);
  });

  it('returns nothing for a featureless listing', () => {
    expect(buildKeyFeatures(make())).toEqual([]);
  });
});
