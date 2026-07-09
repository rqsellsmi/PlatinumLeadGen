import { describe, it, expect } from 'vitest';
import { propertyFamily, similarityScore, type SimilarHomesParams } from '../lib/idx';
import type { IdxListing } from '../drizzle/schema';

/** Minimal IdxListing stub — only the fields the ranker reads matter. */
function listing(partial: Partial<IdxListing>): IdxListing {
  return {
    city: null,
    latitude: null,
    longitude: null,
    bedsTotal: null,
    bathsTotal: null,
    livingArea: null,
    propertyType: null,
    propertySubType: null,
    yearBuilt: null,
    listPrice: null,
    ...partial,
  } as IdxListing;
}

describe('propertyFamily', () => {
  it('buckets RESO subtypes into coarse families', () => {
    expect(propertyFamily('Single Family Residence')).toBe('single');
    expect(propertyFamily('Condominium')).toBe('condo');
    expect(propertyFamily('Residential', 'Single Family')).toBe('single');
    expect(propertyFamily('Multi Family', '2 Unit')).toBe('multi');
    expect(propertyFamily(null, undefined)).toBeNull();
  });
});

describe('similarityScore', () => {
  const subject: SimilarHomesParams = {
    priceRangeLow: 240_000,
    priceRangeHigh: 360_000,
    estimatedValue: 300_000,
    city: 'Brighton',
    latitude: 42.53,
    longitude: -83.78,
    beds: 3,
    baths: 2,
    sqft: 1800,
    yearBuilt: 2005,
    propertyType: 'Single Family',
  };

  it('ranks a near-identical home above a dissimilar one', () => {
    const twin = listing({
      city: 'Brighton',
      latitude: 42.54,
      longitude: -83.79,
      bedsTotal: 3,
      bathsTotal: 2,
      livingArea: 1850,
      propertySubType: 'Single Family Residence',
      yearBuilt: 2007,
      listPrice: 305_000,
    });
    const different = listing({
      city: 'Detroit',
      latitude: 42.33,
      longitude: -83.05,
      bedsTotal: 1,
      bathsTotal: 1,
      livingArea: 700,
      propertySubType: 'Condominium',
      yearBuilt: 1960,
      listPrice: 255_000,
    });
    expect(similarityScore(subject, twin)).toBeLessThan(similarityScore(subject, different));
  });

  it('does not penalise missing candidate fields as mismatches', () => {
    const sparse = listing({ city: 'Brighton', listPrice: 300_000 });
    // Only city (match) + price (match) contribute → near-zero score.
    expect(similarityScore(subject, sparse)).toBeLessThan(1);
  });

  it('treats same-city as a stronger match than a far-away city', () => {
    const sameCity = listing({ city: 'Brighton', bedsTotal: 3, listPrice: 300_000 });
    const otherCity = listing({ city: 'Ann Arbor', bedsTotal: 3, listPrice: 300_000 });
    expect(similarityScore(subject, sameCity)).toBeLessThan(similarityScore(subject, otherCity));
  });
});
