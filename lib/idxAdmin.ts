/**
 * Admin queries for the IDX management pages (IDX spec §2.7 / §8).
 */
import { and, desc, eq, sql, ilike, count } from 'drizzle-orm';
import { db } from './db';
import { idxListings, idxSyncLog, leads, type IdxSyncLogRow, type IdxListing } from '../drizzle/schema';

export interface IdxSyncStatus {
  recent: IdxSyncLogRow[];
  lastSuccess: IdxSyncLogRow | null;
  lastFailure: IdxSyncLogRow | null;
  byStatus: { status: string; count: number }[];
  officeCount: number;
  marketCount: number;
  totalCount: number;
  byCounty: { county: string | null; count: number }[];
}

export async function getIdxSyncStatus(): Promise<IdxSyncStatus> {
  const [recent, byStatusRows, officeRows, byCountyRows] = await Promise.all([
    db.select().from(idxSyncLog).orderBy(desc(idxSyncLog.syncStartedAt)).limit(10),
    db
      .select({ status: idxListings.standardStatus, count: count() })
      .from(idxListings)
      .groupBy(idxListings.standardStatus),
    db
      .select({ isOffice: idxListings.isOfficeListing, count: count() })
      .from(idxListings)
      .groupBy(idxListings.isOfficeListing),
    db
      .select({ county: idxListings.countyOrParish, count: count() })
      .from(idxListings)
      .groupBy(idxListings.countyOrParish)
      .orderBy(desc(count()))
      .limit(25),
  ]);

  const byStatus = byStatusRows.map((r) => ({ status: r.status, count: Number(r.count) }));
  const officeCount = Number(officeRows.find((r) => r.isOffice)?.count ?? 0);
  const totalCount = byStatus.reduce((s, r) => s + r.count, 0);

  return {
    recent,
    // 'partial' = a budget-truncated run that still advanced the cursor; count it
    // as a (non-failing) success so the dashboard shows progress, not "Never".
    lastSuccess: recent.find((r) => r.status === 'success' || r.status === 'partial') ?? null,
    lastFailure: recent.find((r) => r.status === 'failed') ?? null,
    byStatus,
    officeCount,
    marketCount: totalCount - officeCount,
    totalCount,
    byCounty: byCountyRows.map((r) => ({ county: r.county, count: Number(r.count) })),
  };
}

export interface ListingBrowseFilters {
  city?: string;
  status?: string;
  search?: string;
  limit?: number;
}

export async function browseIdxListings(
  filters: ListingBrowseFilters,
): Promise<{ rows: IdxListing[]; total: number }> {
  const { city, status, search, limit = 100 } = filters;
  const conds = [
    city ? sql`LOWER(${idxListings.city}) = LOWER(${city})` : undefined,
    status ? eq(idxListings.standardStatus, status) : undefined,
    search
      ? sql`(${ilike(idxListings.address, `%${search}%`)} OR ${ilike(idxListings.mlsNumber, `%${search}%`)})`
      : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...conds) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.select().from(idxListings).where(where).orderBy(desc(idxListings.modificationTimestamp)).limit(limit),
    db.select({ n: count() }).from(idxListings).where(where),
  ]);
  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

/** Distinct cities present in idx_listings (for the browser filter dropdown). */
export async function idxCities(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ city: idxListings.city })
    .from(idxListings)
    .orderBy(idxListings.city);
  return rows.map((r) => r.city).filter((c): c is string => Boolean(c));
}

export interface MarketReportAccessRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  reportFirstAccessedAt: Date | null;
  reportViewCount: number;
}

/** Leads that have opened their market report, most recent first (§8.3). */
export async function getMarketReportAccessLog(): Promise<MarketReportAccessRow[]> {
  return db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      city: leads.propertyCity,
      reportFirstAccessedAt: leads.reportFirstAccessedAt,
      reportViewCount: leads.reportViewCount,
    })
    .from(leads)
    .where(and(eq(leads.isDeleted, false), sql`${leads.reportViewCount} > 0`))
    .orderBy(desc(leads.reportFirstAccessedAt))
    .limit(200);
}
