import { describe, it, expect } from 'vitest';
import { geoKey, AREA_CATEGORIES, RADIUS_MILES } from '../lib/nearbyPlaces';

describe('geoKey', () => {
  it('rounds to a ~110 m grid cell (3 decimals)', () => {
    expect(geoKey(42.528765, -83.779912)).toBe('42.529,-83.780');
  });
  it('collapses nearby points to the same cell (cache reuse)', () => {
    // ~40 m apart → same cell.
    expect(geoKey(42.52900, -83.78000)).toBe(geoKey(42.52930, -83.78010));
  });
});

describe('AREA_CATEGORIES', () => {
  it('never includes schools (owner request)', () => {
    for (const c of AREA_CATEGORIES) {
      expect(`${c.key} ${c.label} ${c.type ?? ''} ${c.keyword ?? ''}`.toLowerCase()).not.toContain('school');
    }
  });
  it('covers dining, everyday, and outdoors groups', () => {
    const groups = new Set(AREA_CATEGORIES.map((c) => c.group));
    expect(groups).toEqual(new Set(['dining', 'everyday', 'outdoors']));
  });
  it('every category carries a Places type or keyword to search on', () => {
    for (const c of AREA_CATEGORIES) {
      expect(Boolean(c.type || c.keyword)).toBe(true);
    }
  });
});

describe('RADIUS_MILES', () => {
  it('is a sane neighborhood radius', () => {
    expect(RADIUS_MILES).toBeGreaterThan(0);
    expect(RADIUS_MILES).toBeLessThanOrEqual(10);
  });
});
