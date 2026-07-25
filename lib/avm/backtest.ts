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
import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { avmBacktests, idxListings, type IdxListing } from '../../drizzle/schema';
import { normalizeAddress } from '../addressNormalization';
import { valuateFromComps, type AvmResult, type AvmSubject } from './valuate';

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
    lotSizeAcres: l.lotSizeAcres,
    garageSpaces: l.garageSpaces,
    basement: l.basement,
    waterfront: l.waterfrontYN,
    frontageFeet: l.waterFrontageFeet,
    pool: l.poolPrivateYN,
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
export async function runBacktest(inputAddress: string): Promise<BacktestOutcome> {
  const raw = inputAddress.trim();
  const key = normalizeAddress(raw).full;
  if (!key || key.length < 5) return { ok: false, error: 'Enter a full street address.' };
  const streetNum = (raw.match(/^\s*(\d+)/) ?? [])[1];
  if (!streetNum) return { ok: false, error: 'Enter a full street address starting with a house number.' };

  const notes: string[] = [];

  // --- Find this home's listings in our data, matched by normalized address ---
  const candidates = await db
    .select()
    .from(idxListings)
    .where(sql`${idxListings.address} ILIKE ${`${streetNum} %`}`)
    .limit(500);
  const mine = candidates.filter((r) => r.address && normalizeAddress(r.address).full === key);
  if (mine.length === 0) {
    return { ok: false, error: `No listing history for "${raw}" in our IDX data.` };
  }

  const closedSales = mine
    .filter((r) => r.standardStatus === 'Closed' && r.closeDate != null && r.closePrice != null)
    .sort((a, b) => new Date(b.closeDate!).getTime() - new Date(a.closeDate!).getTime());
  if (closedSales.length === 0) {
    return { ok: false, error: `No closed sale on record for "${raw}" to grade against.` };
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
          lotSizeAcres: r.lotSizeAcres,
          garageSpaces: r.garageSpaces,
          basement: null, // provider is blind to basement finish/walkout/egress
          waterfront: null,
          frontageFeet: null,
          pool: r.pool,
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
        lotSizeAcres: null, garageSpaces: null, basement: null, waterfront: null, frontageFeet: null, pool: null,
        factsSource: 'insufficient (no prior sale, no provider record)',
      };
      notes.push('No prior sale and no provider record — subject facts are minimal, so adjustments are limited.');
    } else {
      subject = providerSubject;
    }
  }

  // --- Comp pool: closed sales BEFORE the held-out sale, near the subject ------
  const windowStart = new Date(saleDate.getTime() - 365 * 86_400_000);
  const hasCoords = subject.latitude != null && subject.longitude != null;
  const pool = await db
    .select()
    .from(idxListings)
    .where(
      and(
        eq(idxListings.standardStatus, 'Closed'),
        isNotNull(idxListings.closeDate),
        lt(idxListings.closeDate, saleDate),
        gte(idxListings.closeDate, windowStart),
        isNotNull(idxListings.closePrice),
        ne(idxListings.listingKey, heldOut.listingKey),
        notLease,
        canDisplay,
      ),
    )
    .orderBy(
      hasCoords
        ? sql`ABS(COALESCE(${idxListings.latitude}, 0) - ${subject.latitude}) + ABS(COALESCE(${idxListings.longitude}, 0) - ${subject.longitude}) ASC`
        : desc(idxListings.closeDate),
    )
    .limit(250);

  // Drop the home's own other sales/relistings (normalized-address match).
  const compPool = pool.filter((r) => !(r.address && normalizeAddress(r.address).full === key));

  const result = valuateFromComps(subject, compPool, { now: saleDate });

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
        compsJson: JSON.stringify({ used: result.compsUsed, rejected: result.compsRejected }),
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
