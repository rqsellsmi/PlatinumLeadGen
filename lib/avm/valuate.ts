/**
 * Comp-based valuation over a candidate pool — the glass-box "value + show the
 * work" step. Pure w.r.t. the DB: it takes the subject and a pool of comps
 * (IdxListing rows — Closed, Pending, Under-Contract, and Active) and returns the
 * indicated value, range, confidence, the comps it USED (each with a reason + the
 * adjustment line items), and the comps it REJECTED (each with why).
 *
 * Selection is CLOSEST-FIRST ring expansion (spec §18.4, owner direction): use the
 * tightest radius that yields enough comps, widening only when a tight ring is too
 * thin — so a far comp is never chosen when nearer ones exist. All listing statuses
 * are considered, not just Closed: a nearby home that went Pending in a few days
 * is strong evidence of what buyers will pay. Price uses `closePrice ?? listPrice`
 * and each comp is weighted in reconciliation by its status reliability
 * (Closed > Pending/UC > Active). Attribute similarity uses the shared
 * `similarityScore` (lib/idx) so it stays consistent with the consumer lists.
 */
import { similarityScore, type ComparableSubject } from '../idx';
import type { IdxListing } from '../../drizzle/schema';
import {
  DEFAULT_COEFFICIENTS,
  ENGINE_VERSION,
  adjustComp,
  hardFilterReason,
  makeDriverSet,
  parseStories,
  propertyFamily,
  reconcile,
  statusReliability,
  type AvmCoefficients,
  type Confidence,
  type LineItem,
  type ReconInput,
} from './engine';

/** Radius rings (miles) tried in order — the tightest with enough comps wins. */
const RING_MILES = [0.75, 1.5, 3, 5, 8, 12];

/** Human label for a non-closed status shown in a comp's reason line. */
function statusLabel(status: string | null | undefined): string {
  switch ((status ?? '').trim()) {
    case 'Pending':
      return 'pending';
    case 'ActiveUnderContract':
      return 'under contract';
    case 'Active':
      return 'active';
    case 'Closed':
      return 'sold';
    default:
      return (status ?? '').toLowerCase() || 'listed';
  }
}

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
  propertySubType: string | null; // e.g. "Condominium" vs "Single Family Residence"
  stories: number | null;
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
  status: string; // Closed | Pending | ActiveUnderContract | Active
  daysOnMarket: number | null;
  closeDate: Date | null;
  distanceMiles: number | null;
  rawPrice: number; // closePrice for sold, else listPrice
  adjustedPrice: number;
  similarity: number;
  totalAdjustment: number;
  reliability: number; // status weight used in reconciliation
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
  minComps?: number; // ring expansion widens until at least this many comps
  maxRadiusMiles?: number; // hard cap — never reach past this for a comp
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
  const { limit = 8, minComps = 5, maxRadiusMiles = 12, now = new Date(), coeffs = DEFAULT_COEFFICIENTS } = options;

  // Family from subType + type (a condo's PropertyType is "Residential" — only the
  // subType "Condominium" reveals it), matching how comps are classified.
  const subjFamily = propertyFamily(subject.propertySubType, subject.propertyType);
  const subjComparable: ComparableSubject = {
    latitude: subject.latitude,
    longitude: subject.longitude,
    city: subject.city,
    beds: subject.beds,
    baths: subject.baths,
    sqft: subject.sqft,
    yearBuilt: subject.yearBuilt,
    // Pass the more specific subtype so similarityScore's family term is right too.
    propertyType: subject.propertySubType ?? subject.propertyType,
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

  // Score every passing comp: attribute similarity, PLUS a same-#-of-floors
  // preference (a ranch and a 2-story of equal sqft are different products) and an
  // EXTRA proximity emphasis on top of similarityScore's mild distance term, so the
  // closest comps are weighted more (owner direction). Lower = more comparable.
  const scored = passing.map((comp) => {
    const dist =
      subject.latitude != null && subject.longitude != null && comp.latitude != null && comp.longitude != null
        ? approxMiles(subject.latitude, subject.longitude, comp.latitude, comp.longitude)
        : null;
    const base = similarityScore(subjComparable, comp);
    const compStories = parseStories(comp.storiesTotal, comp.levels);
    const storyPenalty = subject.stories != null && compStories != null ? Math.abs(subject.stories - compStories) * 2 : 0;
    const distPenalty = dist != null ? dist * 0.5 : 0;
    return { comp, dist, similarity: base + storyPenalty + distPenalty };
  });

  // CLOSEST-FIRST ring expansion: use the tightest radius that yields at least
  // `minComps`, widening only up to the hard cap — so a far comp is never chosen
  // while nearer ones exist. With no subject coordinates, proximity is
  // unevaluable, so fall back to attribute similarity across the whole pool.
  const hasCoords = subject.latitude != null && subject.longitude != null;
  let selected: typeof scored;
  if (hasCoords) {
    const withCoords = scored.filter((s) => s.dist != null);
    let ring: typeof scored = [];
    for (const r of RING_MILES) {
      if (r > maxRadiusMiles) break;
      ring = withCoords.filter((s) => s.dist! <= r);
      if (ring.length >= minComps) break;
    }
    if (ring.length === 0) ring = withCoords.filter((s) => s.dist! <= maxRadiusMiles);
    selected = ring;
  } else {
    selected = scored;
  }
  const chosen = [...selected].sort((a, b) => a.similarity - b.similarity).slice(0, limit);

  const compsUsed: AvmCompDetail[] = [];
  const reconInputs: ReconInput[] = [];
  for (const { comp, dist, similarity } of chosen) {
    const rawPrice = (comp.closePrice ?? comp.listPrice)!;
    const adj = adjustComp(subjDrivers, compDrivers(comp), rawPrice, coeffs);
    const withinRadius = dist != null && dist <= maxRadiusMiles;
    const reliability = statusReliability(comp.standardStatus);
    const isClosed = comp.standardStatus === 'Closed';
    const sameCity =
      !!subject.city && !!comp.city && subject.city.trim().toLowerCase() === comp.city.trim().toLowerCase();

    const reasonBits: string[] = [];
    if (dist != null) reasonBits.push(`${dist.toFixed(1)} mi`);
    else if (sameCity) reasonBits.push('same city');
    if (comp.bedsTotal != null || comp.bathsTotal != null) reasonBits.push(`${comp.bedsTotal ?? '?'}bd/${comp.bathsTotal ?? '?'}ba`);
    if (comp.livingArea != null) reasonBits.push(`${comp.livingArea.toLocaleString('en-US')} sqft`);
    const cs = parseStories(comp.storiesTotal, comp.levels);
    if (cs != null) reasonBits.push(cs === 1 ? '1-story' : `${cs}-story`);
    if (isClosed) {
      const m = monthsAgo(comp.closeDate, now);
      reasonBits.push(m != null ? `sold ${m} mo before` : 'sold');
    } else {
      reasonBits.push(statusLabel(comp.standardStatus));
    }
    if (comp.daysOnMarket != null) reasonBits.push(`${comp.daysOnMarket} DOM`);

    compsUsed.push({
      listingKey: comp.listingKey,
      address: comp.internetAddressDisplayYN === false ? null : comp.address,
      city: comp.city,
      status: comp.standardStatus,
      daysOnMarket: comp.daysOnMarket,
      closeDate: comp.closeDate,
      distanceMiles: dist,
      rawPrice,
      adjustedPrice: adj.adjustedPrice,
      similarity,
      totalAdjustment: adj.totalAdjustment,
      reliability,
      lineItems: adj.lineItems,
      reason: reasonBits.join(' · '),
    });
    reconInputs.push({
      adjustedPrice: adj.adjustedPrice,
      rawPrice,
      similarity,
      totalAdjustment: adj.totalAdjustment,
      withinRadius,
      statusWeight: reliability,
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
