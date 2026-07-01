/**
 * Metrics recompute from closings (v1.6 §A.4).
 *
 * Called after every successful CSV import and every batch delete, and manually
 * from /admin/data-upload. Recomputes:
 *   - homepage metrics (home_page_metrics, single row)
 *   - per-location market stats (market_stats) matched by school district
 *   - auto-populated recent sales (diff-based; never touches manual rows/photos)
 *
 * Averages use the 2025 window [2025-01-01, 2026-01-01); if that window is empty
 * for the relevant set, fall back to all-time. Totals use all rows.
 */
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import {
  closings,
  locations,
  marketStats,
  homePageMetrics,
  recentSales,
  type Closing,
} from '../drizzle/schema';

const WINDOW_START = new Date('2025-01-01T00:00:00Z');
const WINDOW_END = new Date('2026-01-01T00:00:00Z');

function round(n: number): number {
  return Math.round(n);
}

/** % of rows sold above list (listPrice present and > 0). 0 when none valid. */
function calcPctAboveList(rows: Closing[]): number {
  const valid = rows.filter((r) => r.listPrice != null && r.listPrice > 0);
  if (valid.length === 0) return 0;
  const above = valid.filter((r) => r.salePrice > (r.listPrice as number)).length;
  return round((above / valid.length) * 100);
}

function calcAvgSalePrice(rows: Closing[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => acc + r.salePrice, 0);
  return round(sum / rows.length);
}

function calcAvgDaysToSell(rows: Closing[]): number {
  const valid = rows.filter((r) => r.daysOnMarket != null && r.daysOnMarket > 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, r) => acc + (r.daysOnMarket as number), 0);
  return round(sum / valid.length);
}

function calcAvgPercentOfList(rows: Closing[]): number {
  const valid = rows.filter((r) => r.percentOfListPrice != null && r.percentOfListPrice > 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, r) => acc + (r.percentOfListPrice as number), 0);
  return round(sum / valid.length);
}

/** Window rows if non-empty, else all rows (all-time fallback). */
function windowOrAll(all: Closing[]): Closing[] {
  const win = all.filter((r) => r.closeDate >= WINDOW_START && r.closeDate < WINDOW_END);
  return win.length > 0 ? win : all;
}

export interface UpdateMetricsResult {
  totalClosings: number;
  locationsUpdated: number;
  recentSalesPopulated: number;
}

export async function updateAllMetrics(): Promise<UpdateMetricsResult> {
  const all = await db.select().from(closings);

  // -------- Homepage metrics (single row) --------
  const homeSource = windowOrAll(all);
  const homeValues = {
    totalHomesSold: all.length,
    pctAboveListPrice: calcPctAboveList(all),
    homesSold: homeSource.length,
    avgSalePrice: calcAvgSalePrice(homeSource),
    avgDaysToSell: calcAvgDaysToSell(homeSource),
    avgPercentOfList: calcAvgPercentOfList(homeSource),
    updatedAt: new Date(),
  };
  const existingHome = await db.select({ id: homePageMetrics.id }).from(homePageMetrics).limit(1);
  if (existingHome[0]) {
    await db.update(homePageMetrics).set(homeValues).where(eq(homePageMetrics.id, existingHome[0].id));
  } else {
    await db.insert(homePageMetrics).values(homeValues);
  }

  // -------- Per-location market stats (by school district) --------
  const locs = await db
    .select()
    .from(locations)
    .where(eq(locations.isActive, true));

  let locationsUpdated = 0;
  let recentSalesPopulated = 0;

  for (const loc of locs) {
    if (!loc.schoolDistrict) continue;
    const district = loc.schoolDistrict.trim().toLowerCase();
    const districtAll = all.filter(
      (c) => (c.schoolDistrict ?? '').trim().toLowerCase() === district,
    );
    if (districtAll.length === 0) continue; // do not zero out existing stats

    const source = windowOrAll(districtAll);
    const statsValues = {
      avgSalePrice: calcAvgSalePrice(source),
      daysToSell: calcAvgDaysToSell(source),
      homesSold: source.length,
      percentOfListPrice: calcAvgPercentOfList(source),
      percentAboveList: calcPctAboveList(districtAll),
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

    // -------- Auto-populate recent sales (diff-based) --------
    const top3 = districtAll
      .filter((c) => c.agentRole === 'listing')
      .sort((a, b) => b.closeDate.getTime() - a.closeDate.getTime())
      .slice(0, 3);
    const top3Ids = new Set(top3.map((c) => c.id));

    const existingAuto = await db
      .select()
      .from(recentSales)
      .where(and(eq(recentSales.locationId, loc.id), eq(recentSales.isAutoPopulated, true)));
    const existingByClosing = new Map(
      existingAuto.filter((r) => r.closingId != null).map((r) => [r.closingId as number, r]),
    );

    // Delete auto rows no longer in the top 3 (never touch manual rows).
    for (const row of existingAuto) {
      if (row.closingId == null || !top3Ids.has(row.closingId)) {
        await db.delete(recentSales).where(eq(recentSales.id, row.id));
      }
    }

    // Insert / update the current top 3.
    for (let i = 0; i < top3.length; i++) {
      const c = top3[i];
      const existing = existingByClosing.get(c.id);
      if (existing) {
        await db
          .update(recentSales)
          .set({
            address: c.address,
            soldPrice: c.salePrice,
            daysOnMarket: c.daysOnMarket,
            closeDate: c.closeDate,
            displayOrder: i,
            // Never touch photoUrl on auto-populated rows.
          })
          .where(eq(recentSales.id, existing.id));
      } else {
        await db.insert(recentSales).values({
          locationId: loc.id,
          address: c.address,
          soldPrice: c.salePrice,
          daysOnMarket: c.daysOnMarket,
          closeDate: c.closeDate,
          photoUrl: null,
          displayOrder: i,
          isAutoPopulated: true,
          closingId: c.id,
        });
      }
      recentSalesPopulated += 1;
    }
  }

  return { totalClosings: all.length, locationsUpdated, recentSalesPopulated };
}

/** Reset all metrics to empty (used by "Clear All Closings"). */
export async function resetAllMetrics(): Promise<void> {
  // Remove auto-populated recent sales (manual rows preserved).
  await db.delete(recentSales).where(eq(recentSales.isAutoPopulated, true));
  const now = new Date();
  const existingHome = await db.select({ id: homePageMetrics.id }).from(homePageMetrics).limit(1);
  const empty = {
    totalHomesSold: 0,
    pctAboveListPrice: 0,
    homesSold: 0,
    avgSalePrice: 0,
    avgDaysToSell: 0,
    avgPercentOfList: 0,
    updatedAt: now,
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

// Re-export low-level calcs for potential reuse/testing.
export { calcPctAboveList, calcAvgSalePrice, calcAvgDaysToSell, calcAvgPercentOfList };
