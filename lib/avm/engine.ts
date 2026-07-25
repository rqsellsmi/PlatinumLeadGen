/**
 * Homegrown comp-based AVM — the pure valuation engine.
 *
 * This module is intentionally free of any DB / network / `@/` imports so it can
 * be unit-tested directly (see `tests/avm.test.ts`) and so the vitest alias trap
 * (lessons §17) never bites. The DB-facing orchestration lives in
 * `lib/avm/valuate.ts` (comp selection via the shared ranker) and
 * `lib/avm/backtest.ts` (hold-one-out against real sales).
 *
 * Design: docs/superpowers/specs/2026-07-23-homegrown-avm-design.md §18.
 * Method = appraiser-style comparable-sales grid: for each comp, add/subtract a
 * dollar line-item per difference from the subject (so the comp represents "what
 * it would have sold for AS the subject"), then reconcile the adjusted comps into
 * one indicated value + range + confidence.
 *
 * v0.1 uses ONLY structured MLS fields for the adjustments (waterfront/frontage,
 * sqft, beds/baths, garage, acreage, basement finished/walkout/egress, pool,
 * age). The AI condition-from-photos layer (spec §8/§18.5) plugs in later, once a
 * self-hosted model is stood up — deliberately NOT wired now, so no IDX data
 * leaves our environment (Agreement §7.5/§7.6/§7.7; spec §19).
 */

export const ENGINE_VERSION = 'avm-v0.1';

// ---------------------------------------------------------------------------
// Coefficients — the dollar value of each driver difference.
// ---------------------------------------------------------------------------
/**
 * PLACEHOLDER coefficients. These are deliberately editable in one place: the
 * whole point of the backtest scoreboard is to reveal where they're wrong and
 * tune them against real sale prices. Do NOT treat these as calibrated — they're
 * a starting grid for a SE-Michigan market, to be corrected as the backtest runs
 * (and, later, informed by a regression on our own sold data — spec §7).
 */
export interface AvmCoefficients {
  perSqft: number; // $ per square foot of living-area difference
  perBedroom: number; // $ per bedroom
  perBathroom: number; // $ per bathroom (full-equivalent)
  perGarageSpace: number; // $ per garage bay
  perAcre: number; // $ per acre of lot difference
  perFrontageFoot: number; // $ per foot of water frontage (waterfront comps only)
  basementFinished: number; // $ for a finished basement
  basementWalkout: number; // $ for a walkout
  basementEgress: number; // $ for an egress window (bedroom-legal lower level)
  pool: number; // $ for an in-ground pool
  perYearNewer: number; // $ per year of effective-age difference
}

export const DEFAULT_COEFFICIENTS: AvmCoefficients = {
  perSqft: 100,
  perBedroom: 5_000,
  perBathroom: 8_000,
  perGarageSpace: 8_000,
  perAcre: 15_000,
  perFrontageFoot: 3_000,
  basementFinished: 20_000,
  basementWalkout: 15_000,
  basementEgress: 3_000,
  pool: 20_000,
  perYearNewer: 500,
};

// ---------------------------------------------------------------------------
// Drivers — the normalized value-driver view of a home.
// ---------------------------------------------------------------------------
export interface DriverSet {
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  garageSpaces: number | null;
  acreage: number | null;
  waterfront: boolean | null;
  frontageFeet: number | null;
  basementKnown: boolean; // was a basement field present at all?
  basementFinished: boolean;
  basementWalkout: boolean;
  basementEgress: boolean;
  pool: boolean | null;
  yearBuilt: number | null;
}

/** Parse the RESO `Basement` enum comma-list into finished/walkout/egress flags. */
export function parseBasement(text: string | null | undefined): {
  known: boolean;
  finished: boolean;
  walkout: boolean;
  egress: boolean;
} {
  if (!text || !text.trim()) return { known: false, finished: false, walkout: false, egress: false };
  const tokens = text.toLowerCase().split(/[,;/]/).map((t) => t.trim());
  // "Unfinished" contains "finished" — exclude it explicitly.
  const finished = tokens.some((t) => /finished/.test(t) && !/unfinished/.test(t));
  const walkout = tokens.some((t) => /walk[\s-]?out/.test(t));
  const egress = tokens.some((t) => /egress/.test(t));
  return { known: true, finished, walkout, egress };
}

/** Fields the driver extractor needs, named uniformly (callers map their rows to this). */
export interface DriverInput {
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  garageSpaces: number | null;
  acreage: number | null;
  waterfront: boolean | null;
  frontageFeet: number | null;
  basement: string | null;
  pool: boolean | null;
  yearBuilt: number | null;
}

export function makeDriverSet(f: DriverInput): DriverSet {
  const b = parseBasement(f.basement);
  return {
    sqft: f.sqft,
    beds: f.beds,
    baths: f.baths,
    garageSpaces: f.garageSpaces,
    acreage: f.acreage,
    waterfront: f.waterfront,
    frontageFeet: f.frontageFeet,
    basementKnown: b.known,
    basementFinished: b.finished,
    basementWalkout: b.walkout,
    basementEgress: b.egress,
    pool: f.pool,
    yearBuilt: f.yearBuilt,
  };
}

// ---------------------------------------------------------------------------
// Adjustment grid — one comp adjusted to the subject.
// ---------------------------------------------------------------------------
export interface LineItem {
  driver: string;
  detail: string; // human-readable ("Subject 1,800 sqft vs comp 1,600")
  amount: number; // + raises the comp toward the subject, − lowers it
}

export interface AdjustmentResult {
  adjustedPrice: number;
  lineItems: LineItem[];
  totalAdjustment: number; // sum of |amount| — how much work it took to match
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (n: number) => n.toLocaleString('en-US');

/**
 * Adjust one comp's sale price to the subject via the coefficient grid. Each line
 * only fires when BOTH homes have the datum (missing data never fabricates an
 * adjustment). Sign convention: `amount = (subject − comp) × coeff`, so a positive
 * amount means the subject has more of that driver and the comp is adjusted UP.
 */
export function adjustComp(
  subject: DriverSet,
  comp: DriverSet,
  rawPrice: number,
  coeffs: AvmCoefficients = DEFAULT_COEFFICIENTS,
): AdjustmentResult {
  const lineItems: LineItem[] = [];
  const add = (driver: string, detail: string, amount: number) => {
    if (Math.round(amount) !== 0) lineItems.push({ driver, detail, amount });
  };

  if (subject.sqft != null && comp.sqft != null) {
    const d = subject.sqft - comp.sqft;
    add('Living area', `${num(subject.sqft)} vs ${num(comp.sqft)} sqft`, d * coeffs.perSqft);
  }
  if (subject.beds != null && comp.beds != null) {
    const d = subject.beds - comp.beds;
    add('Bedrooms', `${subject.beds} vs ${comp.beds}`, d * coeffs.perBedroom);
  }
  if (subject.baths != null && comp.baths != null) {
    const d = subject.baths - comp.baths;
    add('Bathrooms', `${subject.baths} vs ${comp.baths}`, d * coeffs.perBathroom);
  }
  if (subject.garageSpaces != null && comp.garageSpaces != null) {
    const d = subject.garageSpaces - comp.garageSpaces;
    add('Garage', `${subject.garageSpaces} vs ${comp.garageSpaces} bays`, d * coeffs.perGarageSpace);
  }
  if (subject.acreage != null && comp.acreage != null) {
    const d = subject.acreage - comp.acreage;
    add('Acreage', `${subject.acreage} vs ${comp.acreage} ac`, d * coeffs.perAcre);
  }
  // Frontage only when BOTH are waterfront (the on/off filter is applied upstream).
  if (
    subject.waterfront === true &&
    comp.waterfront === true &&
    subject.frontageFeet != null &&
    comp.frontageFeet != null
  ) {
    const d = subject.frontageFeet - comp.frontageFeet;
    add('Water frontage', `${num(subject.frontageFeet)} vs ${num(comp.frontageFeet)} ft`, d * coeffs.perFrontageFoot);
  }
  if (subject.basementKnown && comp.basementKnown) {
    const bf = (subject.basementFinished ? 1 : 0) - (comp.basementFinished ? 1 : 0);
    add('Finished basement', `${subject.basementFinished ? 'yes' : 'no'} vs ${comp.basementFinished ? 'yes' : 'no'}`, bf * coeffs.basementFinished);
    const wo = (subject.basementWalkout ? 1 : 0) - (comp.basementWalkout ? 1 : 0);
    add('Walkout', `${subject.basementWalkout ? 'yes' : 'no'} vs ${comp.basementWalkout ? 'yes' : 'no'}`, wo * coeffs.basementWalkout);
    const eg = (subject.basementEgress ? 1 : 0) - (comp.basementEgress ? 1 : 0);
    add('Egress window', `${subject.basementEgress ? 'yes' : 'no'} vs ${comp.basementEgress ? 'yes' : 'no'}`, eg * coeffs.basementEgress);
  }
  if (subject.pool != null && comp.pool != null) {
    const d = (subject.pool ? 1 : 0) - (comp.pool ? 1 : 0);
    add('Pool', `${subject.pool ? 'yes' : 'no'} vs ${comp.pool ? 'yes' : 'no'}`, d * coeffs.pool);
  }
  if (subject.yearBuilt != null && comp.yearBuilt != null) {
    const d = subject.yearBuilt - comp.yearBuilt;
    add('Age', `built ${subject.yearBuilt} vs ${comp.yearBuilt}`, d * coeffs.perYearNewer);
  }

  const totalSigned = lineItems.reduce((s, li) => s + li.amount, 0);
  const totalAdjustment = lineItems.reduce((s, li) => s + Math.abs(li.amount), 0);
  return { adjustedPrice: Math.round(rawPrice + totalSigned), lineItems, totalAdjustment };
}

/** Format a line item for display, e.g. "Water frontage: 80 vs 60 ft +$60,000". */
export function formatLineItem(li: LineItem): string {
  const sign = li.amount >= 0 ? '+' : '−';
  return `${li.driver}: ${li.detail} ${sign}${money(Math.abs(li.amount))}`;
}

// ---------------------------------------------------------------------------
// Reconciliation — combine the adjusted comps into one value + range.
// ---------------------------------------------------------------------------
export type Confidence = 'low' | 'medium' | 'high';

export interface ReconInput {
  adjustedPrice: number;
  rawPrice: number;
  similarity: number; // lower = more similar (from similarityScore)
  totalAdjustment: number;
  withinRadius: boolean;
}

export interface Reconciliation {
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: Confidence;
  compsUsed: number;
}

/**
 * Weighted reconciliation. Each comp is weighted by similarity AND by how little
 * adjustment it needed (a comp that had to be heavily adjusted is a weaker signal).
 * Range comes from the weighted dispersion of the adjusted values; confidence from
 * comp count + dispersion + adjustment magnitude (spec §9 — honest, data-derived).
 */
export function reconcile(comps: ReconInput[]): Reconciliation {
  const usable = comps.filter((c) => Number.isFinite(c.adjustedPrice) && c.rawPrice > 0);
  if (usable.length === 0) {
    return { value: null, low: null, high: null, confidence: 'low', compsUsed: 0 };
  }

  const weightOf = (c: ReconInput) => {
    const simW = 1 / (1 + Math.max(0, c.similarity));
    const adjPct = c.totalAdjustment / c.rawPrice;
    const adjW = 1 / (1 + adjPct * 2); // heavy adjustments discounted
    return simW * adjW;
  };

  const weights = usable.map(weightOf);
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  const value = usable.reduce((s, c, i) => s + c.adjustedPrice * weights[i], 0) / wSum;

  // Weighted standard deviation of the adjusted values → the range.
  const variance =
    usable.reduce((s, c, i) => s + weights[i] * (c.adjustedPrice - value) ** 2, 0) / wSum;
  const stdev = Math.sqrt(Math.max(0, variance));
  const band = Math.max(stdev, value * 0.04); // never claim tighter than ±4%
  const low = Math.round(value - band);
  const high = Math.round(value + band);

  const dispersionPct = value > 0 ? band / value : 1;
  const avgAdjPct =
    usable.reduce((s, c) => s + c.totalAdjustment / c.rawPrice, 0) / usable.length;
  const nearby = usable.filter((c) => c.withinRadius).length;

  let confidence: Confidence = 'medium';
  if (nearby >= 5 && dispersionPct < 0.08 && avgAdjPct < 0.15) confidence = 'high';
  else if (usable.length < 3 || dispersionPct > 0.2 || avgAdjPct > 0.35) confidence = 'low';

  return { value: Math.round(value), low, high, confidence, compsUsed: usable.length };
}

/** Coarse property-family bucket (mirrors lib/idx.propertyFamily, kept local & pure). */
export function propertyFamily(...values: (string | null | undefined)[]): string | null {
  const s = values.filter(Boolean).join(' ').toLowerCase();
  if (!s) return null;
  if (/(condo|apartment|co-?op)/.test(s)) return 'condo';
  if (/(multi|duplex|triplex|fourplex|2 unit|income)/.test(s)) return 'multi';
  if (/(land|lot|acre|vacant)/.test(s)) return 'land';
  if (/(single|residential|detached|ranch|colonial|bungalow|cape)/.test(s)) return 'single';
  return null;
}

/**
 * Hard filter: a comp must share the subject's waterfront status (never comp
 * on-water against off-water — the single biggest lever, spec §6.1) and property
 * family. Returns a rejection reason, or null if the comp passes.
 */
export function hardFilterReason(
  subjectWaterfront: boolean | null,
  subjectFamily: string | null,
  compWaterfront: boolean | null,
  compFamily: string | null,
): string | null {
  if (subjectWaterfront === true && compWaterfront !== true) return 'off-water (subject is waterfront)';
  if (subjectWaterfront === false && compWaterfront === true) return 'waterfront (subject is not)';
  if (subjectFamily && compFamily && subjectFamily !== compFamily) {
    return `different property type (${compFamily} vs ${subjectFamily})`;
  }
  return null;
}
