import { redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agentLeadOrder } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import AgentDashboard, {
  type AgentLeadItem,
  type AgentKpi,
  type LeadStatus,
} from '@/components/agent/AgentDashboard';
import ScorePanel from '@/components/agent/ScorePanel';
import { formatPriceRange, relativeTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function greetingFor(name: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(
      new Date(),
    ),
  );
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name}`;
}

export default async function AgentLeadsPage() {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  const rows = await db
    .select({
      leadOfferId: leadOffers.id,
      status: leads.status,
      acceptedAt: leadOffers.acceptedAt,
      offerSentAt: leadOffers.offerSentAt,
      firstName: leads.firstName,
      lastName: leads.lastName,
      propertyAddress: leads.propertyAddress,
      propertyCity: leads.propertyCity,
      estimatedValue: leads.estimatedValue,
      priceRangeLow: leads.priceRangeLow,
      priceRangeHigh: leads.priceRangeHigh,
      timeframe: leads.timeframe,
      position: agentLeadOrder.position,
    })
    .from(leadOffers)
    .innerJoin(leads, eq(leadOffers.leadId, leads.id))
    .leftJoin(
      agentLeadOrder,
      and(eq(agentLeadOrder.leadOfferId, leadOffers.id), eq(agentLeadOrder.agentId, agent.id)),
    )
    .where(and(eq(leadOffers.agentId, agent.id), eq(leadOffers.status, 'accepted')))
    .orderBy(sql`${agentLeadOrder.position} asc nulls last`, desc(leadOffers.acceptedAt));

  const items: AgentLeadItem[] = rows.map((r) => ({
    leadOfferId: r.leadOfferId,
    name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unnamed lead',
    address: [r.propertyAddress, r.propertyCity].filter(Boolean).join(', ') || null,
    status: r.status as LeadStatus,
    priceRange: formatPriceRange(r.priceRangeLow, r.priceRangeHigh, r.estimatedValue),
    timeframe: r.timeframe,
    agoLabel: relativeTime(r.acceptedAt ?? r.offerSentAt),
    daysSinceAccepted:
      r.acceptedAt != null ? Math.floor((Date.now() - new Date(r.acceptedAt).getTime()) / 86_400_000) : null,
  }));

  const active = items.length;
  const toContact = items.filter((i) => i.status === 'new').length;

  // Avg first-response (accept) time for this agent.
  const avgRow = await db
    .select({
      mins: sql<number | null>`avg(extract(epoch from (${leadOffers.acceptedAt} - ${leadOffers.offerSentAt}))/60)`,
    })
    .from(leadOffers)
    .where(and(eq(leadOffers.agentId, agent.id), eq(leadOffers.status, 'accepted')));
  const avgMins = avgRow[0]?.mins != null ? `${Math.round(Number(avgRow[0].mins))}m` : '—';

  // Closed this month (lead reached closed; offer belongs to this agent).
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const closedRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leadOffers)
    .innerJoin(leads, eq(leadOffers.leadId, leads.id))
    .where(
      and(
        eq(leadOffers.agentId, agent.id),
        eq(leads.status, 'closed'),
        sql`${leads.lastStatusChangedAt} >= ${startOfMonth}`,
      ),
    );
  const closedThisMo = Number(closedRow[0]?.n ?? 0);

  const kpis: AgentKpi[] = [
    { label: 'Active leads', value: String(active) },
    { label: 'To contact', value: String(toContact), tone: toContact > 0 ? 'danger' : 'neutral' },
    { label: 'Avg response', value: avgMins },
    { label: 'Closed this mo.', value: String(closedThisMo), tone: 'success' },
  ];

  return (
    <div className="space-y-6">
      <ScorePanel />
      <AgentDashboard
        greeting={greetingFor(agent.firstName)}
        subline={`${active} active lead${active === 1 ? '' : 's'} · ${toContact} to contact`}
        kpis={kpis}
        items={items}
      />
    </div>
  );
}
