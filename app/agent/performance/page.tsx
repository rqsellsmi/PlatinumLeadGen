import { redirect } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { getActiveRoutingAgents } from '@/lib/autoOffer';
import { getRoutingQueue } from '@/lib/queue';
import ScorePanel from '@/components/agent/ScorePanel';

export const dynamic = 'force-dynamic';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default async function AgentPerformancePage() {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  // --- KPI stats -----------------------------------------------------------
  const [acceptedRow, avgRow, closedRow] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .where(and(eq(leadOffers.agentId, agent.id), eq(leadOffers.status, 'accepted'))),
    db
      .select({
        mins: sql<number | null>`avg(extract(epoch from (${leadOffers.acceptedAt} - ${leadOffers.offerSentAt}))/60)`,
      })
      .from(leadOffers)
      .where(and(eq(leadOffers.agentId, agent.id), eq(leadOffers.status, 'accepted'))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .where(and(eq(leadOffers.agentId, agent.id), eq(leads.status, 'closed'))),
  ]);
  const acceptedTotal = Number(acceptedRow[0]?.n ?? 0);
  const closedTotal = Number(closedRow[0]?.n ?? 0);
  const avgMins = avgRow[0]?.mins != null ? `${Math.round(Number(avgRow[0].mins))}m` : '—';
  const conversion = acceptedTotal > 0 ? Math.round((closedTotal / acceptedTotal) * 100) : 0;

  // --- Closings by month (last 6 months) -----------------------------------
  const since = new Date();
  since.setMonth(since.getMonth() - 5);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const monthRows = await db
    .select({
      ym: sql<string>`to_char(date_trunc('month', ${leads.lastStatusChangedAt}), 'YYYY-MM')`,
      n: sql<number>`count(*)::int`,
    })
    .from(leadOffers)
    .innerJoin(leads, eq(leadOffers.leadId, leads.id))
    .where(
      and(
        eq(leadOffers.agentId, agent.id),
        eq(leads.status, 'closed'),
        sql`${leads.lastStatusChangedAt} >= ${since}`,
      ),
    )
    .groupBy(sql`date_trunc('month', ${leads.lastStatusChangedAt})`);
  const countByYm = new Map(monthRows.map((r) => [r.ym, Number(r.n)]));

  const buckets: { label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ label: MONTH_LABELS[d.getMonth()], count: countByYm.get(ym) ?? 0 });
  }
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  // --- Round-robin position ------------------------------------------------
  let queuePos = '—';
  let queueText = 'You are not currently in the routing rotation.';
  try {
    const available = await getActiveRoutingAgents();
    const { rotationList, pointer } = await getRoutingQueue(available);
    const n = rotationList.length;
    let stepsUntil: number | null = null;
    for (let k = 0; k < n; k++) {
      if (rotationList[(pointer + k) % n] === agent.id) {
        stepsUntil = k;
        break;
      }
    }
    if (stepsUntil != null) {
      queuePos = stepsUntil === 0 ? 'Next' : `#${stepsUntil + 1}`;
      queueText =
        stepsUntil === 0
          ? 'You are next up for a new lead.'
          : `${stepsUntil} agent-slot${stepsUntil === 1 ? '' : 's'} ahead of you.`;
    }
  } catch {
    /* rotation unavailable — leave defaults */
  }

  const stats = [
    { label: 'Accepted leads', value: String(acceptedTotal), sub: 'all time' },
    { label: 'Closed', value: String(closedTotal), sub: 'all time' },
    { label: 'Conversion', value: `${conversion}%`, sub: 'closed / accepted' },
    { label: 'Avg response', value: avgMins, sub: 'time to accept' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-charcoal">Performance</h1>
        <p className="text-sm text-mute">Your closings, conversion, and routing position.</p>
      </div>

      <ScorePanel />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-card border border-line bg-white px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">{s.label}</p>
            <p className="mt-2 font-numeric text-[38px] font-bold leading-none text-charcoal">{s.value}</p>
            <p className="mt-1.5 text-xs text-mute-light">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Closings chart */}
        <div className="rounded-card border border-line bg-white p-6">
          <h2 className="mb-5 font-bold text-charcoal">Closings — last 6 months</h2>
          <div className="flex h-44 items-end gap-3.5">
            {buckets.map((b) => (
              <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <span className="font-numeric text-base font-bold text-charcoal">{b.count}</span>
                <div
                  className="w-full rounded-t bg-platinum-blue"
                  style={{ height: `${Math.max(4, (b.count / maxCount) * 100)}%` }}
                />
                <span className="text-xs text-mute-lighter">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Round-robin position */}
        <div className="rounded-card bg-platinum-blue p-6 text-white">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#A3D4F2]">
            Round-robin position
          </p>
          <p className="mt-3 font-numeric text-5xl font-bold leading-none">{queuePos}</p>
          <p className="mt-2 text-sm text-[#A3D4F2]">{queueText}</p>
          <div className="mt-5 border-t border-white/20 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold">Accepting new leads</p>
                <p className="text-xs text-[#A3D4F2]">
                  {agent.isAvailable ? 'You are in the rotation' : 'Paused — you will be skipped'}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-bold ${
                  agent.isAvailable ? 'bg-white/20 text-white' : 'bg-white/10 text-[#A3D4F2]'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${agent.isAvailable ? 'bg-success' : 'bg-mute-lighter'}`} />
                {agent.isAvailable ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="mt-3 text-xs text-[#A3D4F2]">
              Turn lead routing on or off in <span className="font-semibold text-white">Settings</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
