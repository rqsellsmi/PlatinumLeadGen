/**
 * Property-record orchestration: fetch the full property record for an address
 * (characteristics, tax/assessment, last sale), CACHED by normalized address so
 * repeated lead-detail opens and the admin lookup tool don't re-bill on every
 * view. Internal surfaces only — the agent/admin lead detail and the admin
 * property-lookup tool.
 *
 * RentCast's /properties is the only source here. ATTOM's expandedprofile used
 * to serve this and was removed: ATTOM is billed for exactly one endpoint,
 * attomavm/detail, which the lead-facing valuation uses (see lib/attom). The
 * practical loss is owner-of-record, which RentCast doesn't return.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { propertyRecords, apiUsageLogs } from '../drizzle/schema';
import { normalizeAddress } from './addressNormalization';
import type { PropertyRecord } from './valuation';

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

const PROVIDER = 'rentcast';
const ENDPOINT = '/properties';

async function fetchLive(address: string): Promise<{ raw: unknown; record: PropertyRecord } | null> {
  if (!process.env.RENTCAST_API_KEY) return null;
  const { getRentcastPropertyRecord } = await import('./rentcast');
  return getRentcastPropertyRecord(address);
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
  try {
    fetched = await fetchLive(address);
  } catch (err) {
    await logUsage(PROVIDER, ENDPOINT, address, false, err instanceof Error ? err.message : 'error', Date.now() - start);
    console.error('[propertyRecords] live fetch failed:', err);
    return null;
  }
  if (!fetched) return null; // not configured, or no match — nothing billed
  await logUsage(PROVIDER, ENDPOINT, address, true, null, Date.now() - start);

  // ---- Cache write ---------------------------------------------------------
  const fetchedAt = new Date();
  const rawJson = JSON.stringify({ record: fetched.record, raw: fetched.raw });
  try {
    await db
      .insert(propertyRecords)
      .values({ normalizedAddress: normalized, address, provider: PROVIDER, rawJson, fetchedAt })
      .onConflictDoUpdate({
        target: propertyRecords.normalizedAddress,
        set: { address, provider: PROVIDER, rawJson, fetchedAt },
      });
  } catch (err) {
    console.warn('[propertyRecords] cache write failed:', err);
  }

  return { record: fetched.record, raw: fetched.raw, fetchedAt, provider: PROVIDER, cached: false };
}
