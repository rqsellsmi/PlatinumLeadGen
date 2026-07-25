import { describe, it, expect } from 'vitest';
import { rankBuyerCityTiles, parseExcludedCities, type CityActiveStat } from '../lib/listingSearch';

// An office near Fenton, MI.
const OFFICE = [{ lat: 42.8, lng: -83.7 }];

const stats: CityActiveStat[] = [
  { city: 'Fenton', count: 120, lat: 42.8, lng: -83.7 }, // at the office
  { city: 'Linden', count: 60, lat: 42.82, lng: -83.78 }, // ~4 mi
  { city: 'Detroit', count: 500, lat: 42.33, lng: -83.05 }, // far + excluded
  { city: 'Traverse City', count: 300, lat: 44.76, lng: -85.62 }, // far away
  { city: 'Holly', count: 45, lat: 42.79, lng: -83.62 }, // ~5 mi
];

describe('parseExcludedCities', () => {
  it('splits on commas and newlines, trims, drops blanks', () => {
    expect(parseExcludedCities('Flint, Pontiac,Detroit')).toEqual(['Flint', 'Pontiac', 'Detroit']);
    expect(parseExcludedCities('Flint\nPontiac\n')).toEqual(['Flint', 'Pontiac']);
    expect(parseExcludedCities('')).toEqual([]);
    expect(parseExcludedCities(null)).toEqual([]);
  });
});

describe('rankBuyerCityTiles', () => {
  it('excludes the exclusion list (case-insensitive) even with the highest count', () => {
    const out = rankBuyerCityTiles(stats, OFFICE, ['detroit'], 12);
    expect(out.map((s) => s.city)).not.toContain('Detroit');
  });

  it('keeps only cities within the service radius of an office', () => {
    const out = rankBuyerCityTiles(stats, OFFICE, [], 12);
    const cities = out.map((s) => s.city);
    expect(cities).toContain('Fenton');
    expect(cities).toContain('Linden');
    expect(cities).toContain('Holly');
    expect(cities).not.toContain('Traverse City'); // ~140 mi away
  });

  it('ranks by active count descending and applies the limit', () => {
    const out = rankBuyerCityTiles(stats, OFFICE, ['Detroit'], 2);
    expect(out).toHaveLength(2);
    expect(out[0].city).toBe('Fenton'); // 120
    expect(out[1].city).toBe('Linden'); // 60
  });

  it('skips the radius filter when no office has coordinates', () => {
    const out = rankBuyerCityTiles(stats, [{ lat: null, lng: null }], ['Detroit'], 12);
    // Traverse City now allowed (no geometry to filter on)
    expect(out.map((s) => s.city)).toContain('Traverse City');
  });
});
