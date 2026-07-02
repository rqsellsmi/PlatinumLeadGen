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

/** Area-level market trends (ATTOM sales-trend). Report "Local market" section. */
export interface MarketTrends {
  medianSalePrice: number | null;
  /** % change vs. the prior comparable period. */
  yoyChangePct: number | null;
  /** Number of sales in the latest period. */
  homeSales: number | null;
  /** Human label for the latest period, e.g. "2025". */
  periodLabel: string | null;
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
  /** Prior sales; empty for RentCast. */
  saleHistory: SaleHistoryEntry[];
  /** ATTOM property id — used post-conversion to pull sales comparables. */
  attomId: string | null;
  /** ATTOM ZIP-level geo id — used post-conversion to pull area sales trends. */
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
 * Widen an estimate into the pre-contact "teaser" range (±8%). This is what the
 * modal shows before a visitor gives contact info; the tighter provider range
 * and precise estimate are only revealed on the report page after conversion.
 */
export function teaserRange(result: Pick<ValuationResult, 'estimatedValue' | 'priceRangeLow' | 'priceRangeHigh'>): {
  low: number | null;
  high: number | null;
} {
  const est = result.estimatedValue;
  if (est != null) return { low: Math.round(est * 0.92), high: Math.round(est * 1.08) };
  // No point estimate — widen whatever range we have by a further 8%.
  const low = result.priceRangeLow != null ? Math.round(result.priceRangeLow * 0.92) : null;
  const high = result.priceRangeHigh != null ? Math.round(result.priceRangeHigh * 1.08) : null;
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
