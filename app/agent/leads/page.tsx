import { redirect } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import AgentDashboard, { type AgentKpi } from '@/components/agent/AgentDashboard';
import ScorePanel from '@/components/agent/ScorePanel';
import { loadAgentAcceptedLeads } from '@/lib/agentLeads';

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

export default async function AgentLeadsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  const items = await loadAgentAcceptedLeads(agent.id);
  const q = (searchParams.q ?? '').trim().toLowerCase();
  const visibleItems = q
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) || (i.address ?? '').toLowerCase().includes(q),
      )
    : items;

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
    { label: 'Active leads', value: String(active), sub: 'in your pipeline' },
    {
      label: 'To contact',
      value: String(toContact),
      sub: toContact > 0 ? 'need a first call' : 'all caught up',
      tone: toContact > 0 ? 'danger' : 'neutral',
    },
    { label: 'Avg response', value: avgMins, sub: 'time to accept' },
    { label: 'Closed this mo.', value: String(closedThisMo), sub: 'this month', tone: 'success' },
  ];

  return (
    <div className="space-y-6">
      <ScorePanel />
      <AgentDashboard
        greeting={greetingFor(agent.firstName)}
        subline={
          q
            ? `${visibleItems.length} lead${visibleItems.length === 1 ? '' : 's'} matching “${searchParams.q}”`
            : `${active} active lead${active === 1 ? '' : 's'} · ${toContact} to contact`
        }
        kpis={kpis}
        items={visibleItems}
      />
    </div>
  );
}
