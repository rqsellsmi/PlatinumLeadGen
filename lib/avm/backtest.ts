/**
 * Hold-one-out backtest — the go/no-go accuracy harness (spec §18.2).
 *
 * Given an address that has sold, we:
 *   1. Hold out its MOST-RECENT sale COMPLETELY — price AND facts. It is only the
 *      graded answer; never a comp, never used to characterize the subject (its
 *      listing may carry post-sale facts we wouldn't have known before the sale).
 *   2. Characterize the subject from the 2nd-most-recent sale (MLS history), else
 *      the provider record. (On-demand MLS pull for a missing prior sale is a
 *      deferred follow-up — needs live Realcomp creds; §18.2 cascade step 2.)
 *   3. Build a comp pool of closed sales that closed BEFORE the held-out sale
 *      (no look-ahead), near the subject, excluding the home's own listings.
 *   4. Value it from those comps, fetch the provider AVM for comparison, and
 *      record: actual sale $ vs. provider $ vs. our $ — persisted to the
 *      re-runnable scoreboard (avm_backtests).
 *
 * Admin-internal only; nothing here is consumer/seller-facing (spec §19).
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { avmBacktests, idxListings, type AvmBacktestRow, type IdxListing } from '../../drizzle/schema';
import { normalizeAddress } from '../addressNormalization';
import { valuateFromComps, type AvmResult, type AvmSubject } from './valuate';
import { fetchAddressHistoryFromMls } from './addressHistory';
import { sameProperty } from './addressMatch';
import { applyUpdates, hasUpdates, type SubjectUpdates } from './updates';
import { parseStories, inferWaterfront, waterClass, detectPoleBarn } from './engine';

export interface BacktestRun {
  id: number | null;
  address: string;
  normalizedAddress: string;
  subject: AvmSubject;
  heldOut: {
    listingKey: string;
    address: string | null;
    city: string | null;
    closeDate: Date | null;
    closePrice: number;
  };
  result: AvmResult;
  provider: { name: string; value: number | null; low: number | null; high: number | null } | null;
  customErrorPct: number | null;
  providerErrorPct: number | null;
  compPoolSize: number;
  notes: string[];
}

export type BacktestOutcome = { ok: true; run: BacktestRun } | { ok: false; error: string };

/** Build a precise "why no sale" message from what the on-demand MLS pull returned. */
function noSaleMessage(
  raw: string,
  streetNum: string,
  pull: Awaited<ReturnType<typeof fetchAddressHistoryFromMls>> | null,
): string {
  if (!pull || (!pull.ok && pull.reason === 'Realcomp not configured')) {
    return `No closed sale on record for "${raw}" in our data (MLS lookup not configured).`;
  }
  if (!pull.ok) {
    return `No closed sale for "${raw}" — MLS lookup failed: ${pull.reason}.`;
  }
  const matched = pull.rows.filter((r) => sameProperty(r.address, raw));
  if (matched.length > 0) {
    const desc = matched
      .map(
        (r) =>
          `${r.standardStatus}${r.closePrice != null ? ` $${r.closePrice.toLocaleString('en-US')}` : ' (no price)'}${r.closeDate ? ` on ${r.closeDate}` : ''}`,
      )
      .join('; ');
    return `Found this address in the MLS but no usable closed sale to grade against — ${matched.length} listing(s): ${desc}. (A sale needs both a close date and a close price in the feed.)`;
  }
  if (pull.rows.length > 0) {
    const others = pull.rows.map((r) => r.address).filter(Boolean).slice(0, 5).join('; ');
    return `The MLS returned ${pull.rows.length} listing(s) at #${streetNum} but none on this street (${others}). This home's sale likely predates what the IDX feed serves, or the seller opted out of internet display — either way it isn't in the feed.`;
  }
  const f = pull.filter ? ` [query: ${pull.filter}]` : '';
  return `No closed sale for "${raw}" — the MLS returned zero listings for this address${f}. If a recent sale exists, this points to the address filter (field name/value) rather than feed coverage; otherwise the sale predates the feed or the seller opted out of internet display.`;
}

function subjectFromListing(l: IdxListing, factsSource: string, fallback: IdxListing): AvmSubject {
  return {
    address: l.address,
    city: l.city,
    latitude: l.latitude ?? fallback.latitude,
    longitude: l.longitude ?? fallback.longitude,
    beds: l.bedsTotal,
    baths: l.bathsTotal,
    sqft: l.livingArea,
    yearBuilt: l.yearBuilt,
    propertyType: l.propertyType ?? l.propertySubType,
    propertySubType: l.propertySubType,
    stories: parseStories(l.storiesTotal, l.levels),
    lotSizeAcres: l.lotSizeAcres,
    garageSpaces: l.garageSpaces,
    basement: l.basement,
    waterfront: inferWaterfront(l.waterfrontYN, l.waterBodyName, l.waterfrontFeatures, l.waterFrontageFeet),
    frontageFeet: l.waterFrontageFeet,
    waterBodyName: l.waterBodyName,
    waterFeatures: l.waterfrontFeatures,
    waterClass: waterClass(l.waterfrontYN, l.waterBodyName, l.waterfrontFeatures, l.waterFrontageFeet),
    pool: l.poolPrivateYN,
    poleBarn: detectPoleBarn(l.exteriorFeatures, l.publicRemarks),
    factsSource,
  };
}

/** WHERE: listing is publicly displayable (entire-listing gate). */
const canDisplay = or(
  eq(idxListings.internetEntireListingDisplayYN, true),
  isNull(idxListings.internetEntireListingDisplayYN),
);
/** WHERE: sale, not a lease/rental. */
const notLease = and(
  or(
    isNull(idxListings.propertyType),
    and(
      sql`lower(${idxListings.propertyType}) not like '%lease%'`,
      sql`lower(${idxListings.propertyType}) not like '%rent%'`,
    ),
  ),
  or(
    isNull(idxListings.propertySubType),
    sql`lower(${idxListings.propertySubType}) not like '%lease%'`,
  ),
);

/**
 * Run one hold-one-out backtest for an address and persist it to the scoreboard.
 */
export async function runBacktest(inputAddress: string, updates?: SubjectUpdates): Promise<BacktestOutcome> {
  const raw = inputAddress.trim();
  const key = normalizeAddress(raw).full;
  if (!key || key.length < 5) return { ok: false, error: 'Enter a full street address.' };
  const streetNum = (raw.match(/^\s*(\d+)/) ?? [])[1];
  if (!streetNum) return { ok: false, error: 'Enter a full street address starting with a house number.' };

  const notes: string[] = [];

  // Find this home's CLOSED sales in our data, newest first (matched by
  // normalized address, since idx_listings has no normalized column).
  const findClosedSales = async (): Promise<IdxListing[]> => {
    const candidates = await db
      .select()
      .from(idxListings)
      .where(sql`${idxListings.address} ILIKE ${`${streetNum} %`}`)
      .limit(500);
    return candidates
      .filter((r) => sameProperty(r.address, raw))
      .filter((r) => r.standardStatus === 'Closed' && r.closeDate != null && r.closePrice != null)
      .sort((a, b) => new Date(b.closeDate!).getTime() - new Date(a.closeDate!).getTime());
  };

  let closedSales = await findClosedSales();

  // We need the most-recent sale (the answer) AND a prior sale (to characterize
  // the subject). If our data doesn't hold both, pull this address's history from
  // the MLS feed on demand (spec §18.2 step 2), then re-read — this also
  // opportunistically deepens our store. No-ops safely without Realcomp creds.
  let pull: Awaited<ReturnType<typeof fetchAddressHistoryFromMls>> | null = null;
  if (closedSales.length < 2) {
    pull = await fetchAddressHistoryFromMls(raw);
    if (pull.ok && pull.upserted > 0) {
      notes.push(`Pulled ${pull.upserted} listing(s) at #${streetNum} from the MLS feed.`);
      closedSales = await findClosedSales();
    } else if (!pull.ok && pull.reason && pull.reason !== 'Realcomp not configured') {
      notes.push(`MLS address lookup unavailable: ${pull.reason}`);
    }
  }

  if (closedSales.length === 0) {
    return { ok: false, error: noSaleMessage(raw, streetNum, pull) };
  }

  const heldOut = closedSales[0]; // most-recent sale — the graded answer, held out entirely
  const priorSale = closedSales[1] ?? null;
  const saleDate = new Date(heldOut.closeDate!);
  const actual = heldOut.closePrice!;

  // --- Characterize the subject (MLS prior sale → provider → insufficient) ---
  let subject: AvmSubject;
  if (priorSale) {
    subject = subjectFromListing(
      priorSale,
      `MLS prior sale (${new Date(priorSale.closeDate!).toISOString().slice(0, 10)})`,
      heldOut,
    );
    notes.push('Subject characterized from its prior MLS sale.');
  } else {
    // No 2nd sale in our data. TODO (§18.2 step 2): on-demand MLS pull for a prior
    // sale. For now, fall back to the provider property record.
    let providerSubject: AvmSubject | null = null;
    try {
      const { getPropertyRecord } = await import('../propertyRecords');
      const pr = await getPropertyRecord(raw).catch(() => null);
      if (pr?.record) {
        const r = pr.record;
        providerSubject = {
          address: heldOut.address,
          city: heldOut.city,
          latitude: r.latitude ?? heldOut.latitude,
          longitude: r.longitude ?? heldOut.longitude,
          beds: r.beds,
          baths: r.bathsTotal,
          sqft: r.sqft,
          yearBuilt: r.yearBuilt,
          propertyType: r.propertyType,
          propertySubType: heldOut.propertySubType, // property family is identity, not a valuation fact
          stories: r.stories ?? parseStories(heldOut.storiesTotal, heldOut.levels),
          lotSizeAcres: r.lotSizeAcres,
          garageSpaces: r.garageSpaces,
          basement: null, // provider is blind to basement finish/walkout/egress
          waterfront: inferWaterfront(heldOut.waterfrontYN, heldOut.waterBodyName, heldOut.waterfrontFeatures, heldOut.waterFrontageFeet),
          frontageFeet: heldOut.waterFrontageFeet,
          waterBodyName: heldOut.waterBodyName,
          waterFeatures: heldOut.waterfrontFeatures,
          waterClass: waterClass(heldOut.waterfrontYN, heldOut.waterBodyName, heldOut.waterfrontFeatures, heldOut.waterFrontageFeet),
          pool: r.pool,
          poleBarn: detectPoleBarn(heldOut.exteriorFeatures, heldOut.publicRemarks),
          factsSource: `provider record (${pr.provider})`,
        };
        notes.push('No prior MLS sale; subject characterized from the provider record (blind to non-standard drivers).');
      }
    } catch {
      /* provider unavailable */
    }
    if (!providerSubject) {
      subject = {
        address: heldOut.address,
        city: heldOut.city,
        latitude: heldOut.latitude,
        longitude: heldOut.longitude,
        beds: null, baths: null, sqft: null, yearBuilt: null, propertyType: heldOut.propertyType,
        propertySubType: heldOut.propertySubType, // family/stories/waterfront are identity, not valuation facts
        stories: parseStories(heldOut.storiesTotal, heldOut.levels),
        lotSizeAcres: null, garageSpaces: null, basement: null,
        waterfront: inferWaterfront(heldOut.waterfrontYN, heldOut.waterBodyName, heldOut.waterfrontFeatures, heldOut.waterFrontageFeet),
        frontageFeet: heldOut.waterFrontageFeet,
        waterBodyName: heldOut.waterBodyName,
        waterFeatures: heldOut.waterfrontFeatures,
        waterClass: waterClass(heldOut.waterfrontYN, heldOut.waterBodyName, heldOut.waterfrontFeatures, heldOut.waterFrontageFeet),
        pool: null,
        poleBarn: detectPoleBarn(heldOut.exteriorFeatures, heldOut.publicRemarks),
        factsSource: 'insufficient (no prior sale, no provider record)',
      };
      notes.push('No prior sale and no provider record — subject facts are minimal, so adjustments are limited.');
    } else {
      subject = providerSubject;
    }
  }

  // Fold in operator-entered updates/upgrades since the prior sale (finished
  // basement, added bed/bath/sqft, etc.) so the subject reflects the home as it is
  // TODAY, not as it last sold (spec §5.2). Comps then price toward the improved home.
  if (hasUpdates(updates)) {
    const upd = applyUpdates(subject, updates!);
    subject = upd.subject;
    if (upd.applied.length) notes.push(`Applied updates since last sale: ${upd.applied.join(', ')}.`);
    if (upd.skipped.length) notes.push(`Updates not applied (base value unknown): ${upd.skipped.join(', ')}.`);
  }

  // --- Comp pool: nearby comps of ALL statuses --------------------------------
  // Closed sales are ground truth (gated BEFORE the held-out sale — no look-ahead),
  // and Active / Under-Contract / Pending homes are included too: a nearby home
  // that went pending fast is strong evidence of what buyers will pay (owner
  // direction). Non-closed comps carry no closeDate, so they're taken by list
  // price; they reflect the CURRENT market (a caveat when grading a past sale —
  // surfaced in the notes). Ordered nearest-first; the ring expansion in
  // valuateFromComps then keeps only the closest.
  const windowStart = new Date(saleDate.getTime() - 365 * 86_400_000);
  const hasCoords = subject.latitude != null && subject.longitude != null;
  const pool = await db
    .select()
    .from(idxListings)
    .where(
      and(
        ne(idxListings.listingKey, heldOut.listingKey),
        notLease,
        canDisplay,
        or(
          and(
            eq(idxListings.standardStatus, 'Closed'),
            isNotNull(idxListings.closeDate),
            lt(idxListings.closeDate, saleDate),
            gte(idxListings.closeDate, windowStart),
            isNotNull(idxListings.closePrice),
          ),
          and(
            inArray(idxListings.standardStatus, ['Pending', 'ActiveUnderContract', 'Active']),
            isNotNull(idxListings.listPrice),
          ),
        ),
      ),
    )
    .orderBy(
      hasCoords
        ? sql`ABS(COALESCE(${idxListings.latitude}, 0) - ${subject.latitude}) + ABS(COALESCE(${idxListings.longitude}, 0) - ${subject.longitude}) ASC`
        : desc(idxListings.closeDate),
    )
    .limit(400);

  // Drop the home's own other sales/relistings (normalized-address match).
  const compPool = pool.filter((r) => !sameProperty(r.address, raw));

  const result = valuateFromComps(subject, compPool, { now: saleDate });

  const nonClosedUsed = result.compsUsed.filter((c) => c.status !== 'Closed').length;
  if (nonClosedUsed > 0) {
    notes.push(
      `${nonClosedUsed} of ${result.compsUsed.length} comps are active/under-contract (current-market signal, weighted below closed sales; they reflect today's market, not the sale date).`,
    );
  }

  // --- Provider AVM for comparison (best-effort; no creds → null) --------------
  let provider: BacktestRun['provider'] = null;
  try {
    const { getValuation } = await import('../valuation');
    const v = await getValuation(raw);
    if (v && (v.estimatedValue != null || v.priceRangeLow != null)) {
      provider = { name: v.provider, value: v.estimatedValue, low: v.priceRangeLow, high: v.priceRangeHigh };
    }
  } catch (err) {
    notes.push('Provider AVM comparison unavailable this run.');
    console.warn('[avm/backtest] provider comparison failed:', err);
  }

  const customErrorPct = result.value != null ? (result.value - actual) / actual : null;
  const providerErrorPct = provider?.value != null ? (provider.value - actual) / actual : null;

  // --- Persist to the scoreboard ---------------------------------------------
  let id: number | null = null;
  try {
    const inserted = await db
      .insert(avmBacktests)
      .values({
        normalizedAddress: key,
        address: raw.slice(0, 300),
        subjectJson: JSON.stringify(subject),
        factsSource: subject.factsSource.slice(0, 40),
        heldOutListingKey: heldOut.listingKey,
        actualSalePrice: actual,
        actualSaleDate: saleDate,
        provider: provider?.name ?? null,
        providerValue: provider?.value ?? null,
        providerLow: provider?.low ?? null,
        providerHigh: provider?.high ?? null,
        customValue: result.value,
        customLow: result.low,
        customHigh: result.high,
        customConfidence: result.confidence,
        compsJson: JSON.stringify({ used: result.compsUsed, rejected: result.compsRejected, poolSize: compPool.length }),
        engineVersion: result.engineVersion,
        notes: notes.join(' | ').slice(0, 2000),
      })
      .returning({ id: avmBacktests.id });
    id = inserted[0]?.id ?? null;
  } catch (err) {
    console.warn('[avm/backtest] scoreboard write failed:', err);
  }

  return {
    ok: true,
    run: {
      id,
      address: raw,
      normalizedAddress: key,
      subject,
      heldOut: {
        listingKey: heldOut.listingKey,
        address: heldOut.internetAddressDisplayYN === false ? null : heldOut.address,
        city: heldOut.city,
        closeDate: heldOut.closeDate,
        closePrice: actual,
      },
      result,
      provider,
      customErrorPct,
      providerErrorPct,
      compPoolSize: compPool.length,
      notes,
    },
  };
}

/** The scoreboard: recent backtest runs, newest first. */
export async function listRecentBacktests(limit = 25) {
  return db.select().from(avmBacktests).orderBy(desc(avmBacktests.createdAt)).limit(limit);
}

/** Load one saved run by id (for re-opening it later without re-running). */
export async function getBacktest(id: number): Promise<AvmBacktestRow | null> {
  if (!Number.isFinite(id)) return null;
  const rows = await db.select().from(avmBacktests).where(eq(avmBacktests.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Rebuild a `BacktestRun` from a persisted row so a saved run renders identically
 * to a fresh one — no re-query, no provider call, no new scoreboard row. Every
 * field the detail view needs was stored at run time (subject facts, comps +
 * adjustments, provider/custom values); errors are recomputed from the stored
 * numbers, and the saved timestamp is returned so the page can label it.
 */
export function backtestRowToRun(row: AvmBacktestRow): { run: BacktestRun; savedAt: Date } {
  const subject = safeParse<AvmSubject>(row.subjectJson) ?? ({ factsSource: row.factsSource ?? 'unknown' } as AvmSubject);
  const comps = safeParse<{ used?: AvmResult['compsUsed']; rejected?: AvmResult['compsRejected']; poolSize?: number }>(row.compsJson) ?? {};
  const actual = row.actualSalePrice ?? 0;

  const result: AvmResult = {
    value: row.customValue,
    low: row.customLow,
    high: row.customHigh,
    confidence: (row.customConfidence as AvmResult['confidence']) ?? 'low',
    compsUsed: comps.used ?? [],
    compsRejected: comps.rejected ?? [],
    engineVersion: row.engineVersion ?? '',
  };

  return {
    savedAt: new Date(row.createdAt),
    run: {
      id: row.id,
      address: row.address ?? row.normalizedAddress,
      normalizedAddress: row.normalizedAddress,
      subject,
      heldOut: {
        listingKey: row.heldOutListingKey ?? '',
        address: null,
        city: null,
        closeDate: row.actualSaleDate,
        closePrice: actual,
      },
      result,
      provider: row.provider
        ? { name: row.provider, value: row.providerValue, low: row.providerLow, high: row.providerHigh }
        : null,
      customErrorPct: row.customValue != null && actual ? (row.customValue - actual) / actual : null,
      providerErrorPct: row.providerValue != null && actual ? (row.providerValue - actual) / actual : null,
      compPoolSize: comps.poolSize ?? (comps.used?.length ?? 0) + (comps.rejected?.length ?? 0),
      notes: row.notes ? row.notes.split(' | ').filter(Boolean) : [],
    },
  };
}

function safeParse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
