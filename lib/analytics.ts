/**
 * Admin analytics query helpers (Spec Section 11.2 /admin/analytics).
 * Lead source/variant breakdown, SEO vs ADS conversion, agent response metrics.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { leads, leadOffers, agents } from '../drizzle/schema';

export interface VariantBreakdown {
  variant: string;
  leads: number;
}

/** Lead counts grouped by pageVariant (seo / ads / unknown). */
export async function leadsByVariant(): Promise<VariantBreakdown[]> {
  const rows = await db
    .select({
      variant: sql<string>`coalesce(${leads.pageVariant}, 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(eq(leads.isDeleted, false))
    .groupBy(sql`coalesce(${leads.pageVariant}, 'unknown')`);
  return rows.map((r) => ({ variant: r.variant, leads: Number(r.count) }));
}

/** Lead counts grouped by source. */
export async function leadsBySource(): Promise<{ source: string; leads: number }[]> {
  const rows = await db
    .select({ source: leads.source, count: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.isDeleted, false))
    .groupBy(leads.source);
  return rows.map((r) => ({ source: r.source ?? 'unknown', leads: Number(r.count) }));
}

/** Conversion = leads that reached closed, per variant. */
export async function conversionByVariant(): Promise<
  { variant: string; total: number; closed: number; rate: number }[]
> {
  const rows = await db
    .select({
      variant: sql<string>`coalesce(${leads.pageVariant}, 'unknown')`,
      total: sql<number>`count(*)::int`,
      closed: sql<number>`sum(case when ${leads.status} = 'closed' then 1 else 0 end)::int`,
    })
    .from(leads)
    .where(eq(leads.isDeleted, false))
    .groupBy(sql`coalesce(${leads.pageVariant}, 'unknown')`);
  return rows.map((r) => {
    const total = Number(r.total);
    const closed = Number(r.closed);
    return { variant: r.variant, total, closed, rate: total ? closed / total : 0 };
  });
}

/** Agent response metrics: accepted offers + avg minutes to accept. */
export async function agentResponseMetrics(): Promise<
  { agentId: number; name: string; accepted: number; avgAcceptMins: number | null }[]
> {
  const rows = await db
    .select({
      agentId: agents.id,
      first: agents.firstName,
      last: agents.lastName,
      accepted: sql<number>`sum(case when ${leadOffers.status} = 'accepted' then 1 else 0 end)::int`,
      avgMins: sql<number | null>`avg(case when ${leadOffers.acceptedAt} is not null and ${leadOffers.offerSentAt} is not null then extract(epoch from (${leadOffers.acceptedAt} - ${leadOffers.offerSentAt}))/60 end)`,
    })
    .from(agents)
    .leftJoin(leadOffers, eq(leadOffers.agentId, agents.id))
    .groupBy(agents.id, agents.firstName, agents.lastName);
  return rows.map((r) => ({
    agentId: r.agentId,
    name: [r.first, r.last].filter(Boolean).join(' '),
    accepted: Number(r.accepted ?? 0),
    avgAcceptMins: r.avgMins != null ? Math.round(Number(r.avgMins)) : null,
  }));
}

/** Total non-deleted leads since a date (for CPL). */
export async function leadCountSince(since: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.isDeleted, false), gte(leads.createdAt, since)));
  return Number(rows[0]?.count ?? 0);
}
