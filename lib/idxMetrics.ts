/**
 * Metrics recompute from the IDX feed (IDX spec intro: "All metrics should be
 * updated to use the corresponding data from the IDX feed … only the deals where
 * the listing-side OR buyer-side office is one of our office keys"). Replaces the
 * CSV-closings source for home_page_metrics + market_stats.
 *
 * GUARDED: if there are no office-closed IDX listings yet (feed not backfilled),
 * this is a no-op so it never zeros out the existing closings-derived stats. Once
 * the office sold-backfill has run, the numbers come from IDX. Called at the end
 * of every sync.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { idxListings, locations, marketStats, homePageMetrics } from '../drizzle/schema';

const WINDOW_DAYS = 365;

interface Row {
  closeDate: Date | null;
  listPrice: number | null;
  salePrice: number | null;
  daysOnMarket: number | null;
  city: string | null;
}

const round = (n: number) => Math.round(n);

function pct(v: number): number {
  return round(v);
}
function avgSalePrice(rows: Row[]): number {
  const valid = rows.filter((r) => r.salePrice != null);
  return valid.length ? round(valid.reduce((a, r) => a + (r.salePrice as number), 0) / valid.length) : 0;
}
function avgDaysToSell(rows: Row[]): number {
  const valid = rows.filter((r) => r.daysOnMarket != null && r.daysOnMarket > 0);
  return valid.length ? round(valid.reduce((a, r) => a + (r.daysOnMarket as number), 0) / valid.length) : 0;
}
function avgPercentOfList(rows: Row[]): number {
  const valid = rows.filter((r) => r.listPrice != null && r.listPrice > 0 && r.salePrice != null);
  if (!valid.length) return 0;
  return pct(
    (valid.reduce((a, r) => a + (r.salePrice as number) / (r.listPrice as number), 0) / valid.length) * 100,
  );
}
function pctAboveList(rows: Row[]): number {
  const valid = rows.filter((r) => r.listPrice != null && r.listPrice > 0 && r.salePrice != null);
  if (!valid.length) return 0;
  const above = valid.filter((r) => (r.salePrice as number) > (r.listPrice as number)).length;
  return pct((above / valid.length) * 100);
}

function windowOrAll(all: Row[]): Row[] {
  const start = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const win = all.filter((r) => r.closeDate != null && r.closeDate >= start);
  return win.length > 0 ? win : all;
}

function matchSet(loc: { name: string; matchCities: string | null }): Set<string> {
  const list = (loc.matchCities ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) list.push(loc.name.split(',')[0].trim().toLowerCase());
  return new Set(list);
}

export interface IdxMetricsResult {
  skipped: boolean;
  totalDeals: number;
  locationsUpdated: number;
}

/** Recompute home_page_metrics + market_stats from IDX office-closed deals. */
export async function updateMetricsFromIdx(): Promise<IdxMetricsResult> {
  // Both sides count as "ours" (§ intro). One row per deal (no double-count).
  const rows: Row[] = await db
    .select({
      closeDate: idxListings.closeDate,
      listPrice: idxListings.listPrice,
      salePrice: idxListings.closePrice,
      daysOnMarket: idxListings.daysOnMarket,
      city: idxListings.city,
    })
    .from(idxListings)
    .where(
      and(
        eq(idxListings.isOfficeListing, true),
        eq(idxListings.standardStatus, 'Closed'),
        isNotNull(idxListings.closePrice),
      ),
    );

  if (rows.length === 0) {
    // Feed not backfilled yet — leave existing (closings-derived) stats intact.
    return { skipped: true, totalDeals: 0, locationsUpdated: 0 };
  }

  // -------- Homepage metrics (single row) --------
  const homeSource = windowOrAll(rows);
  const homeValues = {
    totalHomesSold: rows.length,
    homesSold: homeSource.length,
    avgSalePrice: avgSalePrice(homeSource),
    avgDaysToSell: avgDaysToSell(homeSource),
    avgPercentOfList: avgPercentOfList(homeSource),
    pctAboveListPrice: pctAboveList(homeSource),
    updatedAt: new Date(),
  };
  const existingHome = await db.select({ id: homePageMetrics.id }).from(homePageMetrics).limit(1);
  if (existingHome[0]) {
    await db.update(homePageMetrics).set(homeValues).where(eq(homePageMetrics.id, existingHome[0].id));
  } else {
    await db.insert(homePageMetrics).values(homeValues);
  }

  // -------- Per-location market stats (matched by mailing city) --------
  const locs = await db.select().from(locations).where(eq(locations.isActive, true));
  let locationsUpdated = 0;
  for (const loc of locs) {
    const cities = matchSet(loc);
    const matched = rows.filter((c) => cities.has((c.city ?? '').trim().toLowerCase()));
    if (matched.length === 0) continue; // don't zero out existing stats
    const source = windowOrAll(matched);
    const statsValues = {
      avgSalePrice: avgSalePrice(source),
      daysToSell: avgDaysToSell(source),
      homesSold: source.length,
      percentOfListPrice: avgPercentOfList(source),
      percentAboveList: pctAboveList(source),
      updatedAt: new Date(),
    };
    const existing = await db
      .select({ id: marketStats.id })
      .from(marketStats)
      .where(eq(marketStats.locationId, loc.id))
      .limit(1);
    if (existing[0]) {
      await db.update(marketStats).set(statsValues).where(eq(marketStats.id, existing[0].id));
    } else {
      await db.insert(marketStats).values({ locationId: loc.id, ...statsValues });
    }
    locationsUpdated += 1;
  }

  return { skipped: false, totalDeals: rows.length, locationsUpdated };
}
