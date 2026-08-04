/**
 * Server-side store for the two-tier gated valuation report.
 *
 * - storeValuation: called pre-contact by /api/valuation. Persists the FULL
 *   result and returns only the gated teaser payload for the browser.
 * - linkValuationToLead: called on lead submit. Sets leadId (the reveal gate)
 *   and returns the authoritative numbers to write onto the lead.
 * - getRevealedValuation: called by the report page. Returns full detail ONLY
 *   once a lead is linked, so the gate can't be bypassed from the client.
 */
import { and, eq, gt, isNotNull, isNull, desc } from 'drizzle-orm';
import { db } from './db';
import { leads, valuations, type Valuation } from '../drizzle/schema';
import { normalizeAddress } from './addressNormalization';
import {
  isLowConfidence,
  teaserRange,
  type PropertyBasics,
  type PropertyRecord,
  type SaleHistoryEntry,
  type ValuationProvider,
  type ValuationResult,
} from './valuation';

/** What the browser receives before contact — no precise estimate, no detail. */
export interface TeaserPayload {
  token: string;
  rangeLow: number | null;
  rangeHigh: number | null;
  basics: PropertyBasics | null;
}

/** Full detail revealed on the report page after conversion. */
export interface RevealedValuation {
  /** Row id — lets the report page refresh this exact valuation when stale. */
  id: number;
  provider: string;
  address: string | null;
  estimatedValue: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  confidenceScore: number | null;
  /** Confidence below the threshold — show the estimate as agent-review-pending. */
  isUncertain: boolean;
  basics: PropertyBasics | null;
  detail: PropertyRecord | null;
  saleHistory: SaleHistoryEntry[];
  attomId: string | null;
  areaGeoId: string | null;
  latitude: number | null;
  longitude: number | null;
  /** When the provider data was fetched — drives the 30-day staleness check. */
  valuedAt: Date | null;
}

function revealRow(row: Valuation): RevealedValuation {
  return {
    id: row.id,
    provider: row.provider,
    address: row.address,
    estimatedValue: row.estimatedValue,
    priceRangeLow: row.priceRangeLow,
    priceRangeHigh: row.priceRangeHigh,
    confidenceScore: row.confidenceScore,
    isUncertain: isLowConfidence(row.confidenceScore),
    basics: basicsFromRow(row),
    detail: parseDetail(row.detail),
    saleHistory: parseSaleHistory(row.saleHistory),
    attomId: row.attomId,
    areaGeoId: row.areaGeoId,
    latitude: row.latitude,
    longitude: row.longitude,
    valuedAt: row.valuedAt ? new Date(row.valuedAt) : null,
  };
}

/** Rebuild a provider result from a stored row — the cache-hit path. */
export function resultFromRow(row: Valuation): ValuationResult {
  return {
    estimatedValue: row.estimatedValue,
    priceRangeLow: row.priceRangeLow,
    priceRangeHigh: row.priceRangeHigh,
    latitude: row.latitude,
    longitude: row.longitude,
    confidenceScore: row.confidenceScore,
    basics: basicsFromRow(row),
    detail: parseDetail(row.detail),
    saleHistory: parseSaleHistory(row.saleHistory),
    attomId: row.attomId,
    areaGeoId: row.areaGeoId,
    provider: row.provider as ValuationProvider,
  };
}

function basicsFromRow(row: Valuation): PropertyBasics | null {
  const hasAny =
    row.beds != null ||
    row.baths != null ||
    row.sqft != null ||
    row.yearBuilt != null ||
    row.lotSizeSqft != null ||
    row.propertyType != null;
  if (!hasAny) return null;
  return {
    beds: row.beds ?? null,
    baths: row.baths ?? null,
    sqft: row.sqft ?? null,
    yearBuilt: row.yearBuilt ?? null,
    lotSizeSqft: row.lotSizeSqft ?? null,
    propertyType: row.propertyType ?? null,
  };
}

function parseSaleHistory(raw: string | null): SaleHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SaleHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function parseDetail(raw: string | null): PropertyRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PropertyRecord;
    // `extra` is iterated unguarded by the renderer; older rows may lack it.
    return parsed && typeof parsed === 'object'
      ? { ...parsed, extra: Array.isArray(parsed.extra) ? parsed.extra : [] }
      : null;
  } catch {
    return null;
  }
}

/** The column values a provider result maps onto — shared by insert and refresh. */
function resultColumns(result: ValuationResult, valuedAt: Date) {
  const teaser = teaserRange(result);
  const b = result.basics;
  return {
    provider: result.provider,
    estimatedValue: result.estimatedValue,
    priceRangeLow: result.priceRangeLow,
    priceRangeHigh: result.priceRangeHigh,
    teaserRangeLow: teaser.low,
    teaserRangeHigh: teaser.high,
    confidenceScore: result.confidenceScore,
    beds: b?.beds ?? null,
    baths: b?.baths ?? null,
    sqft: b?.sqft ?? null,
    yearBuilt: b?.yearBuilt ?? null,
    lotSizeSqft: b?.lotSizeSqft ?? null,
    propertyType: b?.propertyType ?? null,
    saleHistory: result.saleHistory.length ? JSON.stringify(result.saleHistory) : null,
    detail: result.detail ? JSON.stringify(result.detail) : null,
    attomId: result.attomId,
    areaGeoId: result.areaGeoId,
    latitude: result.latitude,
    longitude: result.longitude,
    valuedAt,
  };
}

/**
 * Persist a full valuation and return the gated teaser for the browser.
 * `token` is an opaque id the client carries to the report page.
 *
 * `valuedAt` is when the PROVIDER data was fetched. Pass the original fetch time
 * when the result came from the address cache, so a copied row doesn't look
 * freshly-fetched and reset the 30-day clock.
 */
export async function storeValuation(
  token: string,
  address: string,
  result: ValuationResult,
  valuedAt: Date = new Date(),
): Promise<TeaserPayload> {
  const teaser = teaserRange(result);
  try {
    await db.insert(valuations).values({
      token,
      address,
      normalizedAddress: normalizeAddress(address).full || null,
      ...resultColumns(result, valuedAt),
    });
  } catch (err) {
    // Persistence is best-effort — the teaser still renders even if the row
    // fails to write; the report page just won't have detail to reveal.
    console.error('[valuationStore] storeValuation failed:', err);
  }
  return { token, rangeLow: teaser.low, rangeHigh: teaser.high, basics: result.basics };
}

/**
 * Newest stored valuation for an address whose provider data is still within
 * `maxAgeMs` — the cache hit that avoids a billable call. Rows with no
 * estimate are skipped: a blank result is not worth serving for 30 days.
 */
export async function findFreshValuation(
  normalizedAddress: string,
  maxAgeMs: number,
): Promise<Valuation | null> {
  if (!normalizedAddress) return null;
  try {
    const rows = await db
      .select()
      .from(valuations)
      .where(
        and(
          eq(valuations.normalizedAddress, normalizedAddress),
          isNotNull(valuations.estimatedValue),
          gt(valuations.valuedAt, new Date(Date.now() - maxAgeMs)),
        ),
      )
      .orderBy(desc(valuations.valuedAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    // A cache miss is always safe — fall through to a live call.
    console.warn('[valuationStore] findFreshValuation failed:', err);
    return null;
  }
}

/**
 * Overwrite a stored valuation with newly-fetched provider data (the >30-day
 * refresh). The token, address and lead link are untouched, so an existing
 * report link keeps working and simply shows the updated numbers.
 *
 * A linked lead carries its own copy of the estimate (and the report page reads
 * the lead's copy first), so it is updated in the same breath — otherwise a
 * refreshed valuation would be invisible on the report.
 */
export async function refreshValuationRow(
  id: number,
  result: ValuationResult,
  valuedAt: Date = new Date(),
): Promise<boolean> {
  try {
    const updated = await db
      .update(valuations)
      .set(resultColumns(result, valuedAt))
      .where(eq(valuations.id, id))
      .returning({ leadId: valuations.leadId });

    const leadId = updated[0]?.leadId ?? null;
    if (leadId != null) {
      await db
        .update(leads)
        .set({
          estimatedValue: result.estimatedValue,
          priceRangeLow: result.priceRangeLow,
          priceRangeHigh: result.priceRangeHigh,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
    }
    return true;
  } catch (err) {
    console.error('[valuationStore] refreshValuationRow failed:', err);
    return false;
  }
}

/**
 * Link a stored valuation to the converted lead (only if not already linked)
 * and return the row so the caller can write authoritative numbers onto the
 * lead. Returns null when the token is unknown.
 */
export async function linkValuationToLead(
  token: string,
  leadId: number,
): Promise<Valuation | null> {
  try {
    const rows = await db.select().from(valuations).where(eq(valuations.token, token)).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.leadId == null) {
      await db
        .update(valuations)
        .set({ leadId })
        .where(and(eq(valuations.token, token), isNull(valuations.leadId)));
    }
    return row;
  } catch (err) {
    console.error('[valuationStore] linkValuationToLead failed:', err);
    return null;
  }
}

/** Read a stored valuation row by token (no gate) — for server-side fill. */
export async function getValuationByToken(token: string): Promise<Valuation | null> {
  if (!token) return null;
  try {
    const rows = await db.select().from(valuations).where(eq(valuations.token, token)).limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.error('[valuationStore] getValuationByToken failed:', err);
    return null;
  }
}

/** Reveal full detail — only once a lead is linked (the server-side gate). */
export async function getRevealedValuation(token: string): Promise<RevealedValuation | null> {
  if (!token) return null;
  try {
    const rows = await db.select().from(valuations).where(eq(valuations.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.leadId == null) return null; // gate: no contact info → no reveal
    return revealRow(row);
  } catch (err) {
    console.error('[valuationStore] getRevealedValuation failed:', err);
    return null;
  }
}

/**
 * Reveal a lead's stored valuation by leadId (used by the durable report link,
 * where the gate is the report token → lead, not the valuation token). Returns
 * the most recent valuation linked to the lead.
 */
export async function getRevealedValuationByLeadId(leadId: number): Promise<RevealedValuation | null> {
  try {
    const rows = await db
      .select()
      .from(valuations)
      .where(eq(valuations.leadId, leadId))
      .orderBy(desc(valuations.id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return revealRow(row);
  } catch (err) {
    console.error('[valuationStore] getRevealedValuationByLeadId failed:', err);
    return null;
  }
}
