/**
 * RentCast API usage dashboard queries (v1.6 §H / §K.7).
 * PostgreSQL date grouping uses TO_CHAR (not MySQL's DATE_FORMAT).
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { apiUsageLogs } from '../drizzle/schema';

const SERVICE = 'rentcast';

function monthStart(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface UsageStats {
  total: number;
  successful: number;
  failed: number;
  avgResponseMs: number | null;
}

/** Totals for the current calendar month. */
export async function monthUsageStats(): Promise<UsageStats> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      successful: sql<number>`sum(case when ${apiUsageLogs.success} then 1 else 0 end)::int`,
      avg: sql<number | null>`avg(${apiUsageLogs.responseTimeMs})`,
    })
    .from(apiUsageLogs)
    .where(and(eq(apiUsageLogs.service, SERVICE), gte(apiUsageLogs.createdAt, monthStart())));
  const total = Number(rows[0]?.total ?? 0);
  const successful = Number(rows[0]?.successful ?? 0);
  return {
    total,
    successful,
    failed: total - successful,
    avgResponseMs: rows[0]?.avg != null ? Math.round(Number(rows[0].avg)) : null,
  };
}

export interface DailyUsage {
  day: string; // YYYY-MM-DD
  total: number;
  success: number;
  failed: number;
}

/** Calls per day for the last `days` days (default 30). */
export async function dailyUsage(days = 30): Promise<DailyUsage[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${apiUsageLogs.createdAt}, 'YYYY-MM-DD')`,
      total: sql<number>`count(*)::int`,
      success: sql<number>`sum(case when ${apiUsageLogs.success} then 1 else 0 end)::int`,
    })
    .from(apiUsageLogs)
    .where(and(eq(apiUsageLogs.service, SERVICE), gte(apiUsageLogs.createdAt, since)))
    .groupBy(sql`to_char(${apiUsageLogs.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${apiUsageLogs.createdAt}, 'YYYY-MM-DD')`);
  return rows.map((r) => {
    const total = Number(r.total);
    const success = Number(r.success);
    return { day: r.day, total, success, failed: total - success };
  });
}

export interface RecentCall {
  id: number;
  createdAt: string | null;
  propertyAddress: string | null;
  estimatedValue: number | null;
  responseTimeMs: number | null;
  success: boolean | null;
  errorMessage: string | null;
}

/** Most recent calls. */
export async function recentCalls(limit = 50): Promise<RecentCall[]> {
  const rows = await db
    .select({
      id: apiUsageLogs.id,
      createdAt: apiUsageLogs.createdAt,
      propertyAddress: apiUsageLogs.propertyAddress,
      estimatedValue: apiUsageLogs.estimatedValue,
      responseTimeMs: apiUsageLogs.responseTimeMs,
      success: apiUsageLogs.success,
      errorMessage: apiUsageLogs.errorMessage,
    })
    .from(apiUsageLogs)
    .where(eq(apiUsageLogs.service, SERVICE))
    .orderBy(desc(apiUsageLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    propertyAddress: r.propertyAddress,
    estimatedValue: r.estimatedValue,
    responseTimeMs: r.responseTimeMs,
    success: r.success,
    errorMessage: r.errorMessage,
  }));
}

export const FREE_TIER_LIMIT = 50;
