/**
 * Valuation cache — 30 days, keyed by normalized address.
 *
 * Every billable AVM call goes through here. The rule:
 *
 *   - stored valuation for this address is under 30 days old → serve it, no call
 *   - older than 30 days (or none) → call the provider, store the result
 *
 * Two entry points, one rule:
 *   - getValuationForAddress() — a visitor requests a valuation (POST /api/valuation)
 *   - refreshIfStale() — someone opens a report page whose numbers have aged out
 *
 * Only a live call is written to api_usage_logs, so /admin/api-usage counts real
 * provider spend rather than page views.
 *
 * Mirrors lib/propertyRecords.ts, which caches the RentCast property record the
 * same way.
 */
import { db } from './db';
import { apiUsageLogs } from '../drizzle/schema';
import { normalizeAddress } from './addressNormalization';
import { getValuation, isLowConfidence, type ValuationResult } from './valuation';
import {
  findFreshValuation,
  refreshValuationRow,
  resultFromRow,
  type RevealedValuation,
} from './valuationStore';

export const VALUATION_MAX_AGE_DAYS = 30;
const MAX_AGE_MS = VALUATION_MAX_AGE_DAYS * 86_400_000;

/** True when provider data is missing or older than the cache window. */
export function isValuationStale(valuedAt: Date | null | undefined): boolean {
  if (!valuedAt) return true;
  const t = new Date(valuedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= MAX_AGE_MS;
}

/** The endpoint each provider bills us for — recorded on the usage log. */
function endpointFor(provider: string): string {
  return provider === 'attom' ? '/attomavm/detail' : '/avm/value';
}

async function logUsage(opts: {
  provider: string;
  address: string;
  ip: string;
  success: boolean;
  errorMessage: string | null;
  responseTimeMs: number;
  result: ValuationResult | null;
}): Promise<void> {
  try {
    await db.insert(apiUsageLogs).values({
      service: opts.result?.provider ?? opts.provider,
      endpoint: endpointFor(opts.result?.provider ?? opts.provider),
      ip: opts.ip,
      statusCode: opts.success ? 200 : 502,
      propertyAddress: opts.address,
      estimatedValue: opts.result?.estimatedValue ?? null,
      priceRangeLow: opts.result?.priceRangeLow ?? null,
      priceRangeHigh: opts.result?.priceRangeHigh ?? null,
      success: opts.success,
      errorMessage: opts.errorMessage,
      responseTimeMs: opts.responseTimeMs,
    });
  } catch (err) {
    console.warn('[valuationCache] usage log failed:', err);
  }
}

/** Fetch live from the active provider, logging the call either way. */
async function fetchLive(address: string, ip: string): Promise<ValuationResult> {
  const start = Date.now();
  const provider = (process.env.VALUATION_PROVIDER ?? 'rentcast').trim().toLowerCase();
  try {
    const result = await getValuation(address);
    await logUsage({
      provider,
      address,
      ip,
      success: true,
      errorMessage: null,
      responseTimeMs: Date.now() - start,
      result,
    });
    return result;
  } catch (err) {
    await logUsage({
      provider,
      address,
      ip,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'valuation error',
      responseTimeMs: Date.now() - start,
      result: null,
    });
    throw err;
  }
}

export interface CachedValuation {
  result: ValuationResult;
  /** When the provider data was fetched — carried forward on a cache hit. */
  valuedAt: Date;
  /** True when no provider call was made. */
  cached: boolean;
}

/**
 * The valuation for an address: cached copy while it's fresh, otherwise a live
 * call. Throws whatever the provider threw — callers decide how to degrade.
 */
export async function getValuationForAddress(
  address: string,
  opts: { force?: boolean; ip?: string } = {},
): Promise<CachedValuation> {
  const { force = false, ip = 'server' } = opts;
  const normalized = normalizeAddress(address).full || null;

  if (!force && normalized) {
    const row = await findFreshValuation(normalized, MAX_AGE_MS);
    if (row?.valuedAt) {
      return { result: resultFromRow(row), valuedAt: new Date(row.valuedAt), cached: true };
    }
  }

  return { result: await fetchLive(address, ip), valuedAt: new Date(), cached: false };
}

/**
 * Re-price a stored valuation whose provider data has aged past the window, and
 * write the new numbers back over the same row (and onto the linked lead). The
 * report link, token and lead stay put — only the valuation changes.
 *
 * Returns the report unchanged when it's still fresh, when there's no address to
 * re-price, or when the refresh fails: a stale-but-real report beats none.
 */
export async function refreshIfStale(
  report: RevealedValuation | null,
): Promise<RevealedValuation | null> {
  if (!report || !report.address || !isValuationStale(report.valuedAt)) return report;

  try {
    // Not forced: if another lead at the same address was re-priced recently,
    // this row copies that data instead of paying for a second call.
    const { result, valuedAt } = await getValuationForAddress(report.address);
    if (result.estimatedValue == null) return report; // provider lost the match — keep what we have
    const written = await refreshValuationRow(report.id, result, valuedAt);
    if (!written) return report;

    return {
      ...report,
      provider: result.provider,
      estimatedValue: result.estimatedValue,
      priceRangeLow: result.priceRangeLow,
      priceRangeHigh: result.priceRangeHigh,
      confidenceScore: result.confidenceScore,
      isUncertain: isLowConfidence(result.confidenceScore),
      basics: result.basics,
      detail: result.detail,
      saleHistory: result.saleHistory,
      attomId: result.attomId,
      areaGeoId: result.areaGeoId,
      latitude: result.latitude ?? report.latitude,
      longitude: result.longitude ?? report.longitude,
      valuedAt,
    };
  } catch (err) {
    console.error('[valuationCache] refreshIfStale failed:', err);
    return report;
  }
}
