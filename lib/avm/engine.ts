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
  allSportsPremium: number; // $ premium of an all-sports lake over a no-wake lake
  poleBarn: number; // $ for a pole barn / large outbuilding
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
  allSportsPremium: 30_000,
  poleBarn: 30_000,
};

/** Detect a pole barn / large outbuilding from exterior features or remarks text. */
export function detectPoleBarn(...texts: (string | null | undefined)[]): boolean {
  const s = texts.filter(Boolean).join(' ').toLowerCase();
  if (!s) return false;
  return /pole ?barn|pole ?building|morton building|out ?building|outbuilding|second garage|\bshop\b/.test(s);
}

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
  poleBarn: boolean | null;
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
  poleBarn?: boolean | null;
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
    poleBarn: f.poleBarn ?? null,
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
  // Pole barn: only add the premium when the SUBJECT is known to have one (pole
  // barns aren't a clean structured field, so an undetected comp is treated as
  // "none"; a comp we DID detect one on cancels the adjustment).
  if (subject.poleBarn === true) {
    const compHas = comp.poleBarn === true ? 1 : 0;
    add('Pole barn', compHas ? 'both have one' : 'subject has one', (1 - compHas) * coeffs.poleBarn);
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
  /**
   * How much to trust this comp's price by listing status: a Closed sale is
   * ground truth (1.0); a Pending / under-contract home cleared the market at ~its
   * list price (strong, ~0.85); an Active home is only an asking price (weaker,
   * ~0.6). Defaults to 1 so older callers/tests are unaffected.
   */
  statusWeight?: number;
}

/** Price-reliability weight for a listing status (Closed = ground truth). */
export function statusReliability(standardStatus: string | null | undefined): number {
  switch ((standardStatus ?? '').trim()) {
    case 'Closed':
      return 1;
    case 'Pending':
    case 'ActiveUnderContract':
      return 0.85;
    case 'Active':
      return 0.6;
    default:
      return 0.5;
  }
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
    const statusW = c.statusWeight ?? 1; // Closed > Pending/UC > Active
    return simW * adjW * statusW;
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

/**
 * Story/level count from the structured fields. Prefers the numeric
 * `StoriesTotal`; else parses the RESO `Levels` enum text ("One", "Two",
 * "Tri-Level", "One and One Half", "Bi-Level", "Quad-Level"). Null when unknown.
 */
export function parseStories(
  storiesTotal: number | null | undefined,
  levels: string | null | undefined,
): number | null {
  if (storiesTotal != null && storiesTotal > 0) return storiesTotal;
  const s = (levels ?? '').toLowerCase();
  if (!s) return null;
  if (/one and one half|1 1\/2|1\.5/.test(s)) return 1.5;
  if (/two and|2\.5/.test(s)) return 2.5;
  if (/tri|three/.test(s)) return 3;
  if (/quad|four/.test(s)) return 4;
  if (/bi-?level/.test(s)) return 2;
  if (/\btwo\b|\b2\b/.test(s)) return 2;
  if (/\bone\b|\b1\b/.test(s)) return 1;
  return null;
}

/**
 * A home's relationship to water — these price and comp very differently:
 *   - `frontage`   : direct water frontage (on the lake/river).
 *   - `across_road`: waterfront across a road (common up-north; a discount to direct).
 *   - `access`     : lake access / deeded / shared / association — no direct frontage.
 *   - `view`       : water view only.
 *   - `none`       : off water.
 * The RESO `WaterfrontYN` boolean is often left unchecked even when the listing is
 * clearly on a named lake, so we infer from all the water fields. Null = no signal.
 */
export type WaterClass = 'frontage' | 'across_road' | 'access' | 'view' | 'none';

export function waterClass(
  waterfrontYN: boolean | null | undefined,
  waterBodyName: string | null | undefined,
  waterfrontFeatures: string | null | undefined,
  waterFrontageFeet: number | null | undefined,
): WaterClass | null {
  const f = (waterfrontFeatures ?? '').toLowerCase();
  // Hard direct-frontage evidence (an agent-checked YN or entered frontage feet).
  const directEvidence = waterfrontYN === true || (waterFrontageFeet != null && waterFrontageFeet > 0);
  if (/across.?(the.?)?(road|street)/.test(f)) return 'across_road';
  // Access / privileges (shared/deeded/common) — beats a bare "frontage" mention
  // (e.g. "Shared Frontage"), but NOT hard direct evidence.
  if (
    !directEvidence &&
    /(access|privile|shared|common|deeded|beach|boat ?launch|association|club)/.test(f)
  ) {
    return 'access';
  }
  if (directEvidence) return 'frontage';
  if (/(water ?front|lake ?front|river ?front|\bfrontage\b|\bdock\b|sea ?wall|\bcanal\b|\bchannel\b|no ?wake|all ?sports)/.test(f)) {
    return 'frontage';
  }
  if (waterBodyName && waterBodyName.trim()) return 'frontage'; // named body, no access keyword → assume frontage
  if (/view/.test(f)) return 'view';
  if (waterfrontYN === false) return 'none';
  return null;
}

/** Coarse comp group for the hard filter: frontage/across-road together, access, dry. */
export function waterGroup(c: WaterClass | null): 'frontage' | 'access' | 'dry' | null {
  if (c == null) return null;
  if (c === 'frontage' || c === 'across_road') return 'frontage';
  if (c === 'access') return 'access';
  return 'dry'; // view + none
}

/** Boolean "has water frontage" — used to gate the frontage $ adjustment + display. */
export function inferWaterfront(
  waterfrontYN: boolean | null | undefined,
  waterBodyName: string | null | undefined,
  waterfrontFeatures: string | null | undefined,
  waterFrontageFeet: number | null | undefined,
): boolean | null {
  const c = waterClass(waterfrontYN, waterBodyName, waterfrontFeatures, waterFrontageFeet);
  if (c == null) return null;
  return c === 'frontage' || c === 'across_road';
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

/** Lake motor policy — an all-sports lake commands a premium over a no-wake one. */
export function lakeType(waterfrontFeatures: string | null | undefined): 'all_sports' | 'no_wake' | null {
  const f = (waterfrontFeatures ?? '').toLowerCase();
  if (/all ?sports?/.test(f)) return 'all_sports';
  if (/no ?wake|no ?motor|electric ?only|non-?motor|all ?sports? restricted/.test(f)) return 'no_wake';
  return null;
}

/**
 * Priced line item for a lake-type difference (all-sports vs no-wake), applied
 * only when both homes are on the water. subject all-sports vs comp no-wake → the
 * comp would be worth more AS the subject, so adjust it UP (and vice versa).
 */
export function lakeTypeAdjustment(
  subjectType: 'all_sports' | 'no_wake' | null,
  compType: 'all_sports' | 'no_wake' | null,
  coeffs: AvmCoefficients = DEFAULT_COEFFICIENTS,
): LineItem | null {
  if (!subjectType || !compType || subjectType === compType) return null;
  const amount = subjectType === 'all_sports' ? coeffs.allSportsPremium : -coeffs.allSportsPremium;
  return { driver: 'Lake type', detail: `${compType.replace('_', '-')} → ${subjectType.replace('_', '-')}`, amount };
}

/**
 * Hard filter: a comp must share the subject's WATER GROUP (frontage/across-road
 * vs lake-access vs dry — never comp a lakefront against an access or off-water
 * home, the single biggest lever, spec §6.1) and property family. Returns a
 * rejection reason, or null if the comp passes.
 */
export function hardFilterReason(
  subjectWater: WaterClass | null,
  subjectFamily: string | null,
  compWater: WaterClass | null,
  compFamily: string | null,
): string | null {
  const sg = waterGroup(subjectWater);
  const cg = waterGroup(compWater);
  if (sg && cg && sg !== cg) {
    const label = (g: string) => (g === 'frontage' ? 'waterfront' : g === 'access' ? 'lake-access' : 'off-water');
    return `${label(cg)} (subject is ${label(sg)})`;
  }
  if (subjectFamily && compFamily && subjectFamily !== compFamily) {
    return `different property type (${compFamily} vs ${subjectFamily})`;
  }
  return null;
}
