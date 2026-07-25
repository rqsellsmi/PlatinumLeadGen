/**
 * Comp-based valuation over a candidate pool — the glass-box "value + show the
 * work" step. Pure w.r.t. the DB: it takes the subject and a pool of closed
 * comps (IdxListing rows) and returns the indicated value, range, confidence, the
 * comps it USED (each with a plain-English reason + the adjustment line items),
 * and the comps it REJECTED (each with why). Comp selection reuses the shared
 * `rankSoldComps`/`similarityScore` engine (lib/idx) so this list ranks the same
 * way the consumer sold-comps list does. Spec §18.4/§18.5.
 */
import { rankSoldComps, similarityScore, type ComparableSubject } from '../idx';
import type { IdxListing } from '../../drizzle/schema';
import {
  DEFAULT_COEFFICIENTS,
  ENGINE_VERSION,
  adjustComp,
  hardFilterReason,
  makeDriverSet,
  propertyFamily,
  reconcile,
  type AvmCoefficients,
  type Confidence,
  type LineItem,
  type ReconInput,
} from './engine';

/** The subject property, characterized from its own MLS history (or a provider). */
export interface AvmSubject {
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  lotSizeAcres: number | null;
  garageSpaces: number | null;
  basement: string | null;
  waterfront: boolean | null;
  frontageFeet: number | null;
  pool: boolean | null;
  /** Provenance label — where these facts came from (spec §18.3). */
  factsSource: string;
}

export interface AvmCompDetail {
  listingKey: string;
  address: string | null;
  city: string | null;
  closeDate: Date | null;
  distanceMiles: number | null;
  rawPrice: number;
  adjustedPrice: number;
  similarity: number;
  totalAdjustment: number;
  lineItems: LineItem[];
  reason: string;
}

export interface AvmRejected {
  listingKey: string;
  address: string | null;
  reason: string;
}

export interface AvmResult {
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: Confidence;
  compsUsed: AvmCompDetail[];
  compsRejected: AvmRejected[];
  engineVersion: string;
}

export interface ValuateOptions {
  limit?: number;
  maxRadiusMiles?: number;
  withinDays?: number;
  now?: Date;
  coeffs?: AvmCoefficients;
}

/** Equirectangular miles (matches lib/idx's internal approximation). */
function approxMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 69;
  const dLng = (bLng - aLng) * 69 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function subjectDrivers(s: AvmSubject) {
  return makeDriverSet({
    sqft: s.sqft,
    beds: s.beds,
    baths: s.baths,
    garageSpaces: s.garageSpaces,
    acreage: s.lotSizeAcres,
    waterfront: s.waterfront,
    frontageFeet: s.frontageFeet,
    basement: s.basement,
    pool: s.pool,
    yearBuilt: s.yearBuilt,
  });
}

function compDrivers(c: IdxListing) {
  return makeDriverSet({
    sqft: c.livingArea,
    beds: c.bedsTotal,
    baths: c.bathsTotal,
    garageSpaces: c.garageSpaces,
    acreage: c.lotSizeAcres,
    waterfront: c.waterfrontYN,
    frontageFeet: c.waterFrontageFeet,
    basement: c.basement,
    pool: c.poolPrivateYN,
    yearBuilt: c.yearBuilt,
  });
}

function monthsAgo(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / (30 * 86_400_000)));
}

/**
 * Value the subject from a pool of closed comps, returning the full reasoning.
 * `pool` should already be scoped to closed, displayable, non-lease sales; this
 * applies the hard filters (waterfront on/off, property family, price present),
 * ranks the survivors, and builds the adjustment grid.
 */
export function valuateFromComps(
  subject: AvmSubject,
  pool: IdxListing[],
  options: ValuateOptions = {},
): AvmResult {
  const { limit = 6, maxRadiusMiles = 15, withinDays = 365, now = new Date(), coeffs = DEFAULT_COEFFICIENTS } = options;

  const subjFamily = propertyFamily(subject.propertyType);
  const subjComparable: ComparableSubject = {
    latitude: subject.latitude,
    longitude: subject.longitude,
    city: subject.city,
    beds: subject.beds,
    baths: subject.baths,
    sqft: subject.sqft,
    yearBuilt: subject.yearBuilt,
    propertyType: subject.propertyType,
    estimatedValue: null,
  };
  const subjDrivers = subjectDrivers(subject);

  const rejected: AvmRejected[] = [];
  const passing: IdxListing[] = [];
  for (const comp of pool) {
    const rawPrice = comp.closePrice ?? comp.listPrice;
    if (rawPrice == null || rawPrice <= 0) {
      rejected.push({ listingKey: comp.listingKey, address: comp.address, reason: 'no sale price on record' });
      continue;
    }
    const compFamily = propertyFamily(comp.propertySubType, comp.propertyType);
    const reason = hardFilterReason(subject.waterfront, subjFamily, comp.waterfrontYN, compFamily);
    if (reason) {
      rejected.push({ listingKey: comp.listingKey, address: comp.address, reason: `excluded — ${reason}` });
      continue;
    }
    passing.push(comp);
  }

  const ranked = rankSoldComps(subjComparable, passing, { limit, maxRadiusMiles, withinDays, now });

  const compsUsed: AvmCompDetail[] = [];
  const reconInputs: ReconInput[] = [];
  for (const comp of ranked) {
    const rawPrice = (comp.closePrice ?? comp.listPrice)!;
    const adj = adjustComp(subjDrivers, compDrivers(comp), rawPrice, coeffs);
    const similarity = similarityScore(subjComparable, comp);
    const dist =
      subject.latitude != null && subject.longitude != null && comp.latitude != null && comp.longitude != null
        ? approxMiles(subject.latitude, subject.longitude, comp.latitude, comp.longitude)
        : null;
    const withinRadius = dist != null && dist <= maxRadiusMiles;
    const sameCity =
      !!subject.city && !!comp.city && subject.city.trim().toLowerCase() === comp.city.trim().toLowerCase();
    const m = monthsAgo(comp.closeDate, now);

    const reasonBits: string[] = [];
    if (sameCity) reasonBits.push('same city');
    else if (dist != null) reasonBits.push(`${dist.toFixed(1)} mi away`);
    if (comp.bedsTotal != null || comp.bathsTotal != null) reasonBits.push(`${comp.bedsTotal ?? '?'}bd/${comp.bathsTotal ?? '?'}ba`);
    if (comp.livingArea != null) reasonBits.push(`${comp.livingArea.toLocaleString('en-US')} sqft`);
    if (m != null) reasonBits.push(`sold ${m} mo before`);

    compsUsed.push({
      listingKey: comp.listingKey,
      address: comp.internetAddressDisplayYN === false ? null : comp.address,
      city: comp.city,
      closeDate: comp.closeDate,
      distanceMiles: dist,
      rawPrice,
      adjustedPrice: adj.adjustedPrice,
      similarity,
      totalAdjustment: adj.totalAdjustment,
      lineItems: adj.lineItems,
      reason: reasonBits.join(' · '),
    });
    reconInputs.push({
      adjustedPrice: adj.adjustedPrice,
      rawPrice,
      similarity,
      totalAdjustment: adj.totalAdjustment,
      withinRadius,
    });
  }

  const rec = reconcile(reconInputs);

  return {
    value: rec.value,
    low: rec.low,
    high: rec.high,
    confidence: rec.confidence,
    compsUsed,
    compsRejected: rejected.slice(0, 10),
    engineVersion: ENGINE_VERSION,
  };
}
