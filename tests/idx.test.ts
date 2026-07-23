import { describe, it, expect } from 'vitest';
import {
  propertyFamily,
  similarityScore,
  rankSoldComps,
  type SimilarHomesParams,
  type ComparableSubject,
} from '../lib/idx';
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
    closePrice: null,
    closeDate: null,
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

  it('scores a sold comp on its close price, not its list price', () => {
    // Subject ~300k. One comp was LISTED at 900k but SOLD at 300k (a great comp);
    // the other LISTED at 300k but SOLD at 500k (a worse comp). Using close price,
    // the sold-at-300k home is the closer match. (If it read list price, the
    // ordering would flip — so this proves closePrice wins.)
    const soldAtEstimate = listing({ listPrice: 900_000, closePrice: 300_000 });
    const soldAbove = listing({ listPrice: 300_000, closePrice: 500_000 });
    expect(similarityScore(subject, soldAtEstimate)).toBeLessThan(
      similarityScore(subject, soldAbove),
    );
  });
});

describe('rankSoldComps', () => {
  const subject: ComparableSubject = {
    latitude: 42.53,
    longitude: -83.78,
    estimatedValue: 300_000,
    city: 'Brighton',
    beds: 3,
    baths: 2,
    sqft: 1800,
    yearBuilt: 2005,
    propertyType: 'Single Family',
  };

  it('ranks a comparable nearby sale above a dissimilar nearby one', () => {
    const twin = listing({
      latitude: 42.54,
      longitude: -83.79,
      bedsTotal: 3,
      bathsTotal: 2,
      livingArea: 1850,
      propertySubType: 'Single Family Residence',
      yearBuilt: 2007,
      closePrice: 305_000,
      closeDate: new Date(),
    });
    const mismatch = listing({
      latitude: 42.54,
      longitude: -83.79,
      bedsTotal: 1,
      bathsTotal: 1,
      livingArea: 700,
      propertySubType: 'Condominium',
      yearBuilt: 1960,
      closePrice: 140_000,
      closeDate: new Date(),
    });
    const ranked = rankSoldComps(subject, [mismatch, twin], { limit: 1 });
    expect(ranked[0]).toBe(twin);
  });

  it('widens beyond the radius when no close comps exist (thin market)', () => {
    // Both far outside the 15mi guardrail → we still return the nearest rather
    // than nothing, nearest-first.
    const far1 = listing({ latitude: 44.0, longitude: -83.78, closePrice: 300_000, closeDate: new Date() });
    const far2 = listing({ latitude: 45.0, longitude: -83.78, closePrice: 300_000, closeDate: new Date() });
    const ranked = rankSoldComps(subject, [far2, far1], { limit: 2, maxRadiusMiles: 15 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toBe(far1);
  });

  it('breaks ties toward the more recent sale', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const common = {
      latitude: 42.53,
      longitude: -83.78,
      bedsTotal: 3,
      bathsTotal: 2,
      livingArea: 1800,
      closePrice: 300_000,
    };
    const fresh = listing({ ...common, closeDate: new Date('2026-06-20T00:00:00Z') }); // ~11 days
    const stale = listing({ ...common, closeDate: new Date('2026-04-05T00:00:00Z') }); // ~87 days
    const ranked = rankSoldComps(subject, [stale, fresh], { limit: 1, withinDays: 90, now });
    expect(ranked[0]).toBe(fresh);
  });

  it('falls back to same-city recency-ordered comps when the subject has no coordinates', () => {
    // No subject coords → nothing is "within radius", so it ranks the whole pool
    // by attribute similarity + recency (proximity term contributes nothing).
    const noCoordSubject: ComparableSubject = { ...subject, latitude: null, longitude: null };
    const brighton = listing({ city: 'Brighton', bedsTotal: 3, closePrice: 300_000, closeDate: new Date() });
    const detroit = listing({ city: 'Detroit', bedsTotal: 3, closePrice: 300_000, closeDate: new Date() });
    const ranked = rankSoldComps(noCoordSubject, [detroit, brighton], { limit: 1 });
    expect(ranked[0]).toBe(brighton);
  });
});
