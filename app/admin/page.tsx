import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agents, locations } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import OverviewDashboard, {
  type Kpi,
  type HotLead,
  type CityStat,
} from '@/components/admin/OverviewDashboard';
import { getRoutingSnapshot } from '@/lib/roundRobin';
import { formatCompactCurrency, formatPriceRange } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const CITY_COLORS = ['bg-platinum-red', 'bg-platinum-blue', 'bg-success', 'bg-warning'];

function leadValue(l: { estimatedValue: number | null; priceRangeLow: number | null; priceRangeHigh: number | null }): number {
  if (l.estimatedValue != null) return l.estimatedValue;
  if (l.priceRangeLow != null && l.priceRangeHigh != null) return (l.priceRangeLow + l.priceRangeHigh) / 2;
  return 0;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn('[admin/overview] query failed:', err);
    return fallback;
  }
}

export default async function AdminOverviewPage() {
  await requireAdmin();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [snapshot, newToday, statusAgg, avgRespRow, liveLeads, hotRows, cityRows] = await Promise.all([
    getRoutingSnapshot(),
    safe(
      async () =>
        Number(
          (
            await db
              .select({ n: sql<number>`count(*)::int` })
              .from(leads)
              .where(and(eq(leads.isDeleted, false), gte(leads.createdAt, startOfToday)))
          )[0]?.n ?? 0,
        ),
      0,
    ),
    safe(
      () =>
        db
          .select({ status: leads.status, n: sql<number>`count(*)::int` })
          .from(leads)
          .where(eq(leads.isDeleted, false))
          .groupBy(leads.status),
      [] as { status: string; n: number }[],
    ),
    safe(
      async () =>
        (
          await db
            .select({
              mins: sql<number | null>`avg(extract(epoch from (${leadOffers.acceptedAt} - ${leadOffers.offerSentAt}))/60)`,
            })
            .from(leadOffers)
            .where(eq(leadOffers.status, 'accepted'))
        )[0]?.mins ?? null,
      null as number | null,
    ),
    safe(
      () =>
        db
          .select({
            estimatedValue: leads.estimatedValue,
            priceRangeLow: leads.priceRangeLow,
            priceRangeHigh: leads.priceRangeHigh,
          })
          .from(leads)
          .where(
            and(
              eq(leads.isDeleted, false),
              sql`${leads.status} not in ('closed','lost')`,
            ),
          ),
      [] as { estimatedValue: number | null; priceRangeLow: number | null; priceRangeHigh: number | null }[],
    ),
    safe(
      () =>
        db
          .select({
            id: leads.id,
            firstName: leads.firstName,
            lastName: leads.lastName,
            address: leads.propertyAddress,
            city: leads.propertyCity,
            estimatedValue: leads.estimatedValue,
            priceRangeLow: leads.priceRangeLow,
            priceRangeHigh: leads.priceRangeHigh,
            agentFirst: agents.firstName,
            agentLast: agents.lastName,
          })
          .from(leads)
          .leftJoin(
            leadOffers,
            and(eq(leadOffers.leadId, leads.id), eq(leadOffers.status, 'accepted')),
          )
          .leftJoin(agents, eq(agents.id, leadOffers.agentId))
          .where(eq(leads.isDeleted, false))
          .orderBy(desc(leads.createdAt))
          .limit(5),
      [] as Array<{
        id: number;
        firstName: string | null;
        lastName: string | null;
        address: string | null;
        city: string | null;
        estimatedValue: number | null;
        priceRangeLow: number | null;
        priceRangeHigh: number | null;
        agentFirst: string | null;
        agentLast: string | null;
      }>,
    ),
    safe(
      () =>
        db
          .select({
            city: sql<string>`coalesce(${leads.propertyCity}, ${locations.name}, 'Other')`,
            n: sql<number>`count(*)::int`,
            volume: sql<number>`coalesce(sum(coalesce(${leads.estimatedValue}, (${leads.priceRangeLow} + ${leads.priceRangeHigh})/2, 0)),0)::bigint`,
          })
          .from(leads)
          .leftJoin(locations, eq(locations.id, leads.locationId))
          .where(eq(leads.isDeleted, false))
          .groupBy(sql`coalesce(${leads.propertyCity}, ${locations.name}, 'Other')`)
          .orderBy(sql`count(*) desc`)
          .limit(4),
      [] as { city: string; n: number; volume: number }[],
    ),
  ]);

  const statusCounts = Object.fromEntries(statusAgg.map((r) => [r.status, Number(r.n)]));
  const total = statusAgg.reduce((acc, r) => acc + Number(r.n), 0);
  const closed = Number(statusCounts['closed'] ?? 0);
  const pipeline = liveLeads.reduce((acc, l) => acc + leadValue(l), 0);
  const avgResp = avgRespRow != null ? `${Math.round(avgRespRow)}m` : '—';

  const kpis: Kpi[] = [
    { label: 'New today', value: String(newToday), sub: 'leads today' },
    {
      label: 'Unassigned',
      value: String(snapshot.waiting),
      sub: snapshot.waiting > 0 ? 'Action needed' : 'All routed',
      subTone: snapshot.waiting > 0 ? 'danger' : 'success',
    },
    { label: 'Avg response', value: avgResp, sub: 'accept time' },
    {
      label: 'Conversion',
      value: total > 0 ? `${Math.round((closed / total) * 100)}%` : '—',
      sub: `${closed} closed`,
    },
    { label: 'Pipeline', value: formatCompactCurrency(pipeline), sub: `${liveLeads.length} live leads` },
  ];

  const hotLeads: HotLead[] = hotRows.map((r) => ({
    id: r.id,
    name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unnamed lead',
    address: r.address ?? '—',
    city: r.city ?? '',
    priceRange: formatPriceRange(r.priceRangeLow, r.priceRangeHigh, r.estimatedValue) ?? '—',
    assignee: [r.agentFirst, r.agentLast].filter(Boolean).join(' ') || null,
  }));

  const maxVolume = Math.max(1, ...cityRows.map((c) => Number(c.volume)));
  const cityStats: CityStat[] = cityRows.map((c, i) => ({
    city: c.city,
    leads: Number(c.n),
    volume: formatCompactCurrency(Number(c.volume)),
    pct: Math.round((Number(c.volume) / maxVolume) * 100),
    color: CITY_COLORS[i % CITY_COLORS.length],
  }));

  const next = snapshot.agents.find((a) => a.id === snapshot.nextAgentId) ?? null;

  return (
    <OverviewDashboard
      kpis={kpis}
      hotLeads={hotLeads}
      cityStats={cityStats}
      nextAgent={next ? { name: next.name, initials: next.initials } : null}
    />
  );
}
