/**
 * Property-record orchestration: fetch the full AVM-provider record for an
 * address (owner, characteristics, tax/assessment, last sale), CACHED by
 * normalized address so repeated lead-detail opens and the admin lookup tool
 * don't re-bill the provider on every view.
 *
 * Provider priority follows the active AVM provider (ATTOM today), with a
 * RentCast fallback when ATTOM has no match and a RentCast key is present.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { propertyRecords, apiUsageLogs } from '../drizzle/schema';
import { normalizeAddress } from './addressNormalization';
import { activeProvider, type PropertyRecord } from './valuation';

export interface PropertyRecordResult {
  record: PropertyRecord;
  raw: unknown;
  fetchedAt: Date;
  provider: string;
  cached: boolean;
}

const DEFAULT_MAX_AGE_DAYS = 30;

async function logUsage(
  service: string,
  endpoint: string,
  address: string,
  success: boolean,
  errorMessage: string | null,
  responseTimeMs: number,
): Promise<void> {
  try {
    await db.insert(apiUsageLogs).values({
      service,
      endpoint,
      ip: 'server',
      statusCode: success ? 200 : 502,
      propertyAddress: address,
      success,
      errorMessage,
      responseTimeMs,
    });
  } catch (err) {
    console.warn('[propertyRecords] usage log failed:', err);
  }
}

async function fetchLive(
  address: string,
): Promise<{ result: { raw: unknown; record: PropertyRecord } | null; provider: string; endpoint: string }> {
  const provider = activeProvider();
  if (provider === 'attom') {
    const { getAttomPropertyRecord } = await import('./attom');
    const attom = await getAttomPropertyRecord(address);
    if (attom) return { result: attom, provider: 'attom', endpoint: '/property/expandedprofile' };
    // ATTOM had no match — fall back to RentCast if configured.
    if (process.env.RENTCAST_API_KEY) {
      const { getRentcastPropertyRecord } = await import('./rentcast');
      const rc = await getRentcastPropertyRecord(address);
      if (rc) return { result: rc, provider: 'rentcast', endpoint: '/properties' };
    }
    return { result: null, provider: 'attom', endpoint: '/property/expandedprofile' };
  }
  const { getRentcastPropertyRecord } = await import('./rentcast');
  const rc = await getRentcastPropertyRecord(address);
  return { result: rc, provider: 'rentcast', endpoint: '/properties' };
}

/**
 * Get the full property record for an address. Returns the cached copy when it's
 * fresh (unless `force`), otherwise fetches live, caches it, and logs the call.
 * Returns null when the provider has no record (or isn't configured).
 */
export async function getPropertyRecord(
  address: string,
  opts: { force?: boolean; maxAgeDays?: number } = {},
): Promise<PropertyRecordResult | null> {
  const { force = false, maxAgeDays = DEFAULT_MAX_AGE_DAYS } = opts;
  const normalized = normalizeAddress(address).full || null;
  if (!normalized) return null;

  // ---- Cache read ----------------------------------------------------------
  if (!force) {
    try {
      const rows = await db
        .select()
        .from(propertyRecords)
        .where(eq(propertyRecords.normalizedAddress, normalized))
        .limit(1);
      const row = rows[0];
      if (row?.rawJson) {
        const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
        if (ageMs < maxAgeDays * 86_400_000) {
          const parsed = JSON.parse(row.rawJson) as { record: PropertyRecord; raw: unknown };
          if (parsed?.record) {
            return {
              record: parsed.record,
              raw: parsed.raw,
              fetchedAt: new Date(row.fetchedAt),
              provider: row.provider,
              cached: true,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[propertyRecords] cache read failed:', err);
    }
  }

  // ---- Live fetch ----------------------------------------------------------
  const start = Date.now();
  let fetched: { raw: unknown; record: PropertyRecord } | null = null;
  let provider = activeProvider() as string;
  let endpoint = '/property/expandedprofile';
  try {
    const live = await fetchLive(address);
    fetched = live.result;
    provider = live.provider;
    endpoint = live.endpoint;
  } catch (err) {
    await logUsage(provider, endpoint, address, false, err instanceof Error ? err.message : 'error', Date.now() - start);
    console.error('[propertyRecords] live fetch failed:', err);
    return null;
  }
  await logUsage(provider, endpoint, address, fetched != null, null, Date.now() - start);
  if (!fetched) return null;

  // ---- Cache write ---------------------------------------------------------
  const fetchedAt = new Date();
  const rawJson = JSON.stringify({ record: fetched.record, raw: fetched.raw });
  try {
    await db
      .insert(propertyRecords)
      .values({ normalizedAddress: normalized, address, provider, rawJson, fetchedAt })
      .onConflictDoUpdate({
        target: propertyRecords.normalizedAddress,
        set: { address, provider, rawJson, fetchedAt },
      });
  } catch (err) {
    console.warn('[propertyRecords] cache write failed:', err);
  }

  return { record: fetched.record, raw: fetched.raw, fetchedAt, provider, cached: false };
}
