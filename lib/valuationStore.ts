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
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { valuations, type Valuation } from '../drizzle/schema';
import {
  teaserRange,
  type PropertyBasics,
  type SaleHistoryEntry,
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
  provider: string;
  address: string | null;
  estimatedValue: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  confidenceScore: number | null;
  basics: PropertyBasics | null;
  saleHistory: SaleHistoryEntry[];
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

/**
 * Persist a full valuation and return the gated teaser for the browser.
 * `token` is an opaque id the client carries to the report page.
 */
export async function storeValuation(
  token: string,
  address: string,
  result: ValuationResult,
): Promise<TeaserPayload> {
  const teaser = teaserRange(result);
  const b = result.basics;
  try {
    await db.insert(valuations).values({
      token,
      provider: result.provider,
      address,
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
      latitude: result.latitude,
      longitude: result.longitude,
    });
  } catch (err) {
    // Persistence is best-effort — the teaser still renders even if the row
    // fails to write; the report page just won't have detail to reveal.
    console.error('[valuationStore] storeValuation failed:', err);
  }
  return { token, rangeLow: teaser.low, rangeHigh: teaser.high, basics: b };
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
    return {
      provider: row.provider,
      address: row.address,
      estimatedValue: row.estimatedValue,
      priceRangeLow: row.priceRangeLow,
      priceRangeHigh: row.priceRangeHigh,
      confidenceScore: row.confidenceScore,
      basics: basicsFromRow(row),
      saleHistory: parseSaleHistory(row.saleHistory),
    };
  } catch (err) {
    console.error('[valuationStore] getRevealedValuation failed:', err);
    return null;
  }
}
