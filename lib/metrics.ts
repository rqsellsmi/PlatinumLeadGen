/**
 * Metrics recompute from closings.
 *
 * Called after every successful CSV import and every batch delete, and manually
 * from /admin/data-upload. Recomputes:
 *   - homepage metrics (home_page_metrics, single row) — totals are all-time,
 *     across every imported transaction (both sides); averages use a rolling
 *     trailing-12-month window (all-time fallback if that window is empty).
 *   - per-location market stats (market_stats) matched by mailing city
 *     (locations.match_cities → closings.city), same rolling window.
 *
 * Recent-sales tiles are NOT materialized here anymore — the public pages read
 * them straight from closings (list-side, RS/CO, newest first).
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { closings, locations, marketStats, homePageMetrics, type Closing } from '../drizzle/schema';

const WINDOW_DAYS = 365;

function round(n: number): number {
  return Math.round(n);
}

function shortCity(name: string): string {
  return name.split(',')[0].trim().toLowerCase();
}

/** The mailing cities a location covers (falls back to its own short name). */
function matchSet(loc: { name: string; matchCities: string | null }): Set<string> {
  const list = (loc.matchCities ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) list.push(shortCity(loc.name));
  return new Set(list);
}

function calcPctAboveList(rows: Closing[]): number {
  const valid = rows.filter((r) => r.listPrice != null && r.listPrice > 0);
  if (valid.length === 0) return 0;
  const above = valid.filter((r) => r.salePrice > (r.listPrice as number)).length;
  return round((above / valid.length) * 100);
}
function calcAvgSalePrice(rows: Closing[]): number {
  if (rows.length === 0) return 0;
  return round(rows.reduce((a, r) => a + r.salePrice, 0) / rows.length);
}
function calcAvgDaysToSell(rows: Closing[]): number {
  const valid = rows.filter((r) => r.daysOnMarket != null && r.daysOnMarket > 0);
  if (valid.length === 0) return 0;
  return round(valid.reduce((a, r) => a + (r.daysOnMarket as number), 0) / valid.length);
}
function calcAvgPercentOfList(rows: Closing[]): number {
  const valid = rows.filter((r) => r.percentOfListPrice != null && r.percentOfListPrice > 0);
  if (valid.length === 0) return 0;
  return round(valid.reduce((a, r) => a + (r.percentOfListPrice as number), 0) / valid.length);
}

/** Rolling trailing-12-month rows if non-empty, else all rows (fallback). */
function windowOrAll(all: Closing[]): Closing[] {
  const start = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const win = all.filter((r) => r.closeDate >= start);
  return win.length > 0 ? win : all;
}

export interface UpdateMetricsResult {
  totalClosings: number;
  locationsUpdated: number;
}

export async function updateAllMetrics(): Promise<UpdateMetricsResult> {
  const all = await db.select().from(closings);

  // -------- Homepage metrics (single row) --------
  // Totals: all-time, every transaction. Averages: rolling 12 months.
  const homeSource = windowOrAll(all);
  const homeValues = {
    totalHomesSold: all.length,
    homesSold: homeSource.length,
    avgSalePrice: calcAvgSalePrice(homeSource),
    avgDaysToSell: calcAvgDaysToSell(homeSource),
    avgPercentOfList: calcAvgPercentOfList(homeSource),
    pctAboveListPrice: calcPctAboveList(homeSource),
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
    const matched = all.filter((c) => cities.has((c.city ?? '').trim().toLowerCase()));
    if (matched.length === 0) continue; // don't zero out existing stats

    const source = windowOrAll(matched);
    const statsValues = {
      avgSalePrice: calcAvgSalePrice(source),
      daysToSell: calcAvgDaysToSell(source),
      homesSold: source.length,
      percentOfListPrice: calcAvgPercentOfList(source),
      percentAboveList: calcPctAboveList(source),
      updatedAt: new Date(),
    };
    const existingStat = await db
      .select({ id: marketStats.id })
      .from(marketStats)
      .where(eq(marketStats.locationId, loc.id))
      .limit(1);
    if (existingStat[0]) {
      await db.update(marketStats).set(statsValues).where(eq(marketStats.id, existingStat[0].id));
    } else {
      await db.insert(marketStats).values({ locationId: loc.id, ...statsValues });
    }
    locationsUpdated += 1;
  }

  return { totalClosings: all.length, locationsUpdated };
}

/** Reset homepage metrics to empty (used by "Clear All Closings"). */
export async function resetAllMetrics(): Promise<void> {
  const existingHome = await db.select({ id: homePageMetrics.id }).from(homePageMetrics).limit(1);
  const empty = {
    totalHomesSold: 0,
    pctAboveListPrice: 0,
    homesSold: 0,
    avgSalePrice: 0,
    avgDaysToSell: 0,
    avgPercentOfList: 0,
    updatedAt: new Date(),
  };
  if (existingHome[0]) {
    await db.update(homePageMetrics).set(empty).where(eq(homePageMetrics.id, existingHome[0].id));
  }
}

/** Convenience used by the importer: earliest/latest close date in a set. */
export function closeDateRange(rows: { closeDate: Date }[]): {
  earliest: Date | null;
  latest: Date | null;
} {
  if (rows.length === 0) return { earliest: null, latest: null };
  let earliest = rows[0].closeDate;
  let latest = rows[0].closeDate;
  for (const r of rows) {
    if (r.closeDate < earliest) earliest = r.closeDate;
    if (r.closeDate > latest) latest = r.closeDate;
  }
  return { earliest, latest };
}

export { calcPctAboveList, calcAvgSalePrice, calcAvgDaysToSell, calcAvgPercentOfList };
