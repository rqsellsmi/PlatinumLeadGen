import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  boundingBox,
  bboxFromRadius,
  milesBetween,
  listingStatusLabel,
  isUnderContractLike,
  parsePolygon,
  encodePolygon,
  normalizeFilters,
  coarsenPin,
  centroidOfFilters,
  describeSearch,
  filtersToQuery,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../lib/listingSearch';

describe('pointInPolygon', () => {
  // A simple square around (42.8, -83.7).
  const square = [
    { lat: 42.7, lng: -83.8 },
    { lat: 42.9, lng: -83.8 },
    { lat: 42.9, lng: -83.6 },
    { lat: 42.7, lng: -83.6 },
  ];
  it('detects an interior point', () => {
    expect(pointInPolygon({ lat: 42.8, lng: -83.7 }, square)).toBe(true);
  });
  it('rejects an exterior point', () => {
    expect(pointInPolygon({ lat: 43.5, lng: -83.7 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 42.8, lng: -84.5 }, square)).toBe(false);
  });
  it('returns false for a degenerate ring', () => {
    expect(pointInPolygon({ lat: 42.8, lng: -83.7 }, [{ lat: 0, lng: 0 }])).toBe(false);
  });
});

describe('boundingBox', () => {
  it('computes min/max lat/lng', () => {
    const bb = boundingBox([
      { lat: 1, lng: 5 },
      { lat: 3, lng: 2 },
      { lat: -2, lng: 8 },
    ]);
    expect(bb).toEqual({ minLat: -2, maxLat: 3, minLng: 2, maxLng: 8 });
  });
  it('returns null for a degenerate ring', () => {
    expect(boundingBox([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBeNull();
  });
});

describe('bboxFromRadius', () => {
  it('brackets the center by roughly the radius', () => {
    const bb = bboxFromRadius({ lat: 42.8, lng: -83.7 }, 10);
    expect(bb.minLat).toBeLessThan(42.8);
    expect(bb.maxLat).toBeGreaterThan(42.8);
    // ~10mi ≈ 0.145deg latitude
    expect(bb.maxLat - 42.8).toBeCloseTo(10 / 69, 3);
    // longitude spread is wider than latitude spread at this latitude
    expect(bb.maxLng - -83.7).toBeGreaterThan(bb.maxLat - 42.8);
  });
});

describe('milesBetween', () => {
  it('is ~0 for identical points', () => {
    expect(milesBetween(42.8, -83.7, 42.8, -83.7)).toBeCloseTo(0, 5);
  });
  it('is ~69 miles per degree of latitude', () => {
    expect(milesBetween(42, -83, 43, -83)).toBeCloseTo(69, 0);
  });
});

describe('listingStatusLabel / isUnderContractLike', () => {
  it('labels Active as For Sale', () => {
    expect(listingStatusLabel({ standardStatus: 'Active', mlsStatus: 'Active' })).toBe('For Sale');
  });
  it('uses the real mls status for AUC', () => {
    expect(
      listingStatusLabel({ standardStatus: 'ActiveUnderContract', mlsStatus: 'Accepting Backup Offers' }),
    ).toBe('Accepting Backup Offers');
  });
  it('falls back to Under Contract when AUC has no mls status', () => {
    expect(listingStatusLabel({ standardStatus: 'ActiveUnderContract', mlsStatus: null })).toBe(
      'Under Contract',
    );
  });
  it('marks AUC and Pending as under-contract-like', () => {
    expect(isUnderContractLike('ActiveUnderContract')).toBe(true);
    expect(isUnderContractLike('Pending')).toBe(true);
    expect(isUnderContractLike('Active')).toBe(false);
  });
});

describe('coarsenPin (address-hidden compliance)', () => {
  it('returns exact coords when not hidden', () => {
    expect(coarsenPin(42.7891, -83.7123, false)).toEqual({ lat: 42.7891, lng: -83.7123 });
  });
  it('rounds to ~2 decimals when hidden', () => {
    expect(coarsenPin(42.7891, -83.7123, true)).toEqual({ lat: 42.79, lng: -83.71 });
  });
});

describe('parsePolygon / encodePolygon', () => {
  it('round-trips a ring', () => {
    const ring = [
      { lat: 42.7, lng: -83.8 },
      { lat: 42.9, lng: -83.8 },
      { lat: 42.9, lng: -83.6 },
    ];
    const enc = encodePolygon(ring);
    const dec = parsePolygon(enc);
    expect(dec).toHaveLength(3);
    expect(dec![0].lat).toBeCloseTo(42.7, 5);
    expect(dec![2].lng).toBeCloseTo(-83.6, 5);
  });
  it('rejects fewer than 3 vertices', () => {
    expect(parsePolygon('42.7,-83.8;42.9,-83.8')).toBeUndefined();
    expect(parsePolygon('')).toBeUndefined();
    expect(parsePolygon(undefined)).toBeUndefined();
  });
});

describe('normalizeFilters', () => {
  it('parses numbers, city, beds/baths, toggles', () => {
    const f = normalizeFilters({
      priceMin: '150000',
      priceMax: '400000',
      bedsMin: '3',
      bathsMin: '2',
      city: '  Fenton ',
      waterfront: '1',
      pool: 'true',
      newConstruction: 'off',
    });
    expect(f.priceMin).toBe(150000);
    expect(f.priceMax).toBe(400000);
    expect(f.bedsMin).toBe(3);
    expect(f.bathsMin).toBe(2);
    expect(f.city).toBe('Fenton');
    expect(f.waterfront).toBe(true);
    expect(f.pool).toBe(true);
    expect(f.newConstruction).toBe(false);
  });
  it('whitelists sort and drops garbage', () => {
    expect(normalizeFilters({ sort: 'price_asc' }).sort).toBe('price_asc');
    expect(normalizeFilters({ sort: 'nonsense' }).sort).toBeUndefined();
    expect(normalizeFilters({ priceMin: 'abc' }).priceMin).toBeUndefined();
  });
  it('parses property types from a comma list', () => {
    expect(normalizeFilters({ propertyTypes: 'Single Family,Condo' }).propertyTypes).toEqual([
      'Single Family',
      'Condo',
    ]);
  });
  it('derives center + default radius from lat/lng', () => {
    const f = normalizeFilters({ lat: '42.8', lng: '-83.7' });
    expect(f.center).toEqual({ lat: 42.8, lng: -83.7 });
    expect(f.radiusMiles).toBe(15);
  });
  it('reads a polygon from the poly param', () => {
    const f = normalizeFilters({ poly: '42.7,-83.8;42.9,-83.8;42.9,-83.6' });
    expect(f.polygon).toHaveLength(3);
  });
  it('clamps page size and defaults page to 1', () => {
    expect(normalizeFilters({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeFilters({ pageSize: '999' }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizeFilters({ page: '0' }).page).toBe(1);
    expect(normalizeFilters({ page: '4' }).page).toBe(4);
  });
});

describe('centroidOfFilters', () => {
  it('prefers an explicit radius center', () => {
    expect(centroidOfFilters({ center: { lat: 42.5, lng: -83.4 }, radiusMiles: 10 })).toEqual({
      lat: 42.5,
      lng: -83.4,
    });
  });
  it('averages a polygon ring', () => {
    const c = centroidOfFilters({
      polygon: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
      ],
    });
    expect(c).toEqual({ lat: 1, lng: 1 });
  });
  it('uses the bbox center when only bounds are set', () => {
    expect(centroidOfFilters({ bbox: { minLat: 42, maxLat: 44, minLng: -84, maxLng: -82 } })).toEqual({
      lat: 43,
      lng: -83,
    });
  });
  it('returns null with no geography', () => {
    expect(centroidOfFilters({ city: 'Clarkston', bedsMin: 3 })).toBeNull();
  });
});

describe('describeSearch', () => {
  it('summarizes city, beds and a price range', () => {
    const label = describeSearch({ city: 'Clarkston', bedsMin: 3, priceMin: 200000, priceMax: 400000 });
    expect(label).toContain('Homes in Clarkston');
    expect(label).toContain('3+ bd');
    expect(label).toContain('$200K–$400K');
  });
  it('renders millions compactly and open-ended ranges', () => {
    expect(describeSearch({ priceMin: 1000000 })).toContain('$1M+');
    expect(describeSearch({ priceMax: 350000 })).toContain('up to $350K');
  });
  it('falls back to a bare label', () => {
    expect(describeSearch({})).toBe('Homes');
    expect(describeSearch({ polygon: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }] })).toContain(
      'drawn area',
    );
  });
});

describe('filtersToQuery', () => {
  it('round-trips the common fields through normalizeFilters', () => {
    const original = {
      priceMin: '200000',
      priceMax: '400000',
      bedsMin: '3',
      city: 'Clarkston',
      type: 'SingleFamilyResidence,Condominium',
      waterfront: '1',
    };
    const q = filtersToQuery(normalizeFilters(original));
    const back = normalizeFilters(Object.fromEntries(new URLSearchParams(q)));
    expect(back.priceMin).toBe(200000);
    expect(back.priceMax).toBe(400000);
    expect(back.bedsMin).toBe(3);
    expect(back.city).toBe('Clarkston');
    expect(back.propertyTypes).toEqual(['SingleFamilyResidence', 'Condominium']);
    expect(back.waterfront).toBe(true);
  });
  it('encodes a radius search', () => {
    const q = filtersToQuery({ center: { lat: 42.8, lng: -83.7 }, radiusMiles: 20 });
    const sp = new URLSearchParams(q);
    expect(sp.get('lat')).toBe('42.8');
    expect(sp.get('lng')).toBe('-83.7');
    expect(sp.get('radius')).toBe('20');
  });
});
