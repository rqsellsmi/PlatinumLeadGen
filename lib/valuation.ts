/**
 * Valuation provider seam.
 *
 * The app talks to ONE normalized interface (`ValuationResult`) and this module
 * decides which provider answers based on the `VALUATION_PROVIDER` runtime env
 * var ('rentcast' | 'attom', default 'rentcast'). Both provider clients are
 * always compiled in; flipping the env var in Vercel is an instant rollback
 * that needs no code change or branch surgery.
 *
 * If ATTOM is selected but errors (or returns no value) and a RentCast key is
 * present, we quietly fall back to RentCast so the valuation form never breaks.
 */

export type ValuationProvider = 'rentcast' | 'attom';

/** Physical property characteristics — only ATTOM populates these today. */
export interface PropertyBasics {
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotSizeSqft: number | null;
  propertyType: string | null;
}

/** A prior sale on record. ATTOM's AVM call carries the most recent one. */
export interface SaleHistoryEntry {
  date: string | null; // ISO yyyy-mm-dd
  price: number | null;
}

/** Property owner of record (public record; shown only on internal lead views). */
export interface PropertyOwner {
  names: string[];
  ownerOccupied: boolean | null;
  mailingAddress: string | null;
}

/**
 * A full property record (characteristics, lot, tax/assessment, last sale,
 * owner of record). Provider-agnostic; every field degrades to null. `extra`
 * holds provider-specific label/value pairs for a generic "more detail" section.
 *
 * Two producers fill this in, and they carry different subsets:
 *  - ATTOM's AVM detail response (`ValuationResult.detail`) — characteristics,
 *    lot, utilities, last sale. No `owner`, no tax/assessment. Lead-facing.
 *  - RentCast's /properties record (lib/propertyRecords) — internal views only.
 * Never render `owner` on a public page; it is public record but internal-only
 * by policy (see components/PropertyDetails).
 */
export interface PropertyRecord {
  provider: ValuationProvider;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  propertyUse: string | null;
  yearBuilt: number | null;
  beds: number | null;
  bathsFull: number | null;
  bathsHalf: number | null;
  bathsTotal: number | null;
  sqft: number | null;
  lotSizeSqft: number | null;
  lotSizeAcres: number | null;
  stories: number | null;
  rooms: number | null;
  units: number | null;
  garageType: string | null;
  garageSpaces: number | null;
  pool: boolean | null;
  heating: string | null;
  cooling: string | null;
  construction: string | null;
  roof: string | null;
  condition: string | null;
  county: string | null;
  subdivision: string | null;
  zoning: string | null;
  apn: string | null;
  lastSaleDate: string | null; // ISO yyyy-mm-dd
  lastSalePrice: number | null;
  assessedValue: number | null;
  marketValue: number | null;
  assessedLand: number | null;
  assessedImprovements: number | null;
  taxAmount: number | null;
  taxYear: number | null;
  owner: PropertyOwner | null;
  attomId: string | null;
  extra: { label: string; value: string }[];
}

/**
 * Below this AVM confidence score (ATTOM SCR, 0–100) the estimate is shown to
 * the homeowner as unverified, with an agent review promised. Scores at or
 * above it render normally.
 */
export const LOW_CONFIDENCE_THRESHOLD = 70;

/**
 * True only when the provider gave us a score AND it is under the threshold.
 * A missing score (RentCast never returns one) is "unknown", not "low" — we
 * don't flag an estimate we have no confidence signal for.
 */
export function isLowConfidence(score: number | null | undefined): boolean {
  return score != null && score < LOW_CONFIDENCE_THRESHOLD;
}

export interface ValuationResult {
  estimatedValue: number | null;
  /** The provider's actual (tight) value range — revealed post-contact. */
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  latitude: number | null;
  longitude: number | null;
  /** ATTOM confidence score (SCR, 0–100); null for RentCast. */
  confidenceScore: number | null;
  /** Property characteristics; null for RentCast. */
  basics: PropertyBasics | null;
  /**
   * Everything else the AVM response carries about the home (lot, construction,
   * utilities, parking, area, last sale). Same shape as an internal property
   * record minus the fields the AVM endpoint doesn't return — `owner` and the
   * tax/assessment block are always null here. Null for RentCast.
   */
  detail: PropertyRecord | null;
  /** Prior sales; empty for RentCast. */
  saleHistory: SaleHistoryEntry[];
  /** ATTOM property id, carried on the AVM response. */
  attomId: string | null;
  /** ATTOM ZIP-level geo id, carried on the AVM response. */
  areaGeoId: string | null;
  provider: ValuationProvider;
}

/** Resolve the active provider from the runtime env var. */
export function activeProvider(): ValuationProvider {
  return (process.env.VALUATION_PROVIDER ?? '').trim().toLowerCase() === 'attom'
    ? 'attom'
    : 'rentcast';
}

/**
 * Widen an estimate into the pre-contact "teaser" range (±10%). This is what the
 * modal shows before a visitor gives contact info; a tighter ±6% band around the
 * precise estimate is revealed on the report page after conversion (see
 * ThankYouClient's PAGE_RANGE_SPREAD).
 */
export function teaserRange(result: Pick<ValuationResult, 'estimatedValue' | 'priceRangeLow' | 'priceRangeHigh'>): {
  low: number | null;
  high: number | null;
} {
  const est = result.estimatedValue;
  if (est != null) return { low: Math.round(est * 0.9), high: Math.round(est * 1.1) };
  // No point estimate — widen whatever range we have by a further 10%.
  const low = result.priceRangeLow != null ? Math.round(result.priceRangeLow * 0.9) : null;
  const high = result.priceRangeHigh != null ? Math.round(result.priceRangeHigh * 1.1) : null;
  return { low, high };
}

/**
 * Fetch a valuation from the active provider (with RentCast fallback).
 * Signature-compatible with the old rentcast.getValuation so existing callers
 * (lat/lng backfill in the lead submit route) work unchanged.
 */
export async function getValuation(address: string): Promise<ValuationResult> {
  // Imported lazily so a provider module's env read never runs for the other.
  const provider = activeProvider();

  if (provider === 'attom') {
    const { getAttomValuation } = await import('./attom');
    try {
      const result = await getAttomValuation(address);
      if (result.estimatedValue == null && process.env.RENTCAST_API_KEY) {
        // ATTOM had no value for this address — fall back so the form still works.
        const { getRentcastValuation } = await import('./rentcast');
        return getRentcastValuation(address);
      }
      return result;
    } catch (err) {
      console.error('[valuation] ATTOM failed; falling back to RentCast:', err);
      if (process.env.RENTCAST_API_KEY) {
        const { getRentcastValuation } = await import('./rentcast');
        return getRentcastValuation(address);
      }
      throw err;
    }
  }

  const { getRentcastValuation } = await import('./rentcast');
  return getRentcastValuation(address);
}
