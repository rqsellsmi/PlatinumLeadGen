import Link from 'next/link';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agents } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { LOST_REASONS, lostReasonLabel } from '@/lib/leadLifecycle';

export const dynamic = 'force-dynamic';

// An agent needs at least this many Lost leads before their reason mix is worth
// reading as a pattern (avoids over-reacting to one or two).
const MIN_LOST_FOR_SIGNAL = 3;
// Share of Lost marked "unresponsive" that's worth a human look.
const UNRESPONSIVE_FLAG = 0.4;

export default async function LostReasonsPage() {
  await requireAdmin();

  // Lost leads = leads carrying a Lost reason (kept even after reopen).
  const lost = await db
    .select({ id: leads.id, reason: leads.lostReason })
    .from(leads)
    .where(and(eq(leads.isDeleted, false), isNotNull(leads.lostReason)));

  const ids = lost.map((l) => l.id);

  // Attribute each Lost to the agent who worked it (most recent accepted offer).
  const agentByLead = new Map<number, number>();
  if (ids.length > 0) {
    const offers = await db
      .select({ leadId: leadOffers.leadId, agentId: leadOffers.agentId, acceptedAt: leadOffers.acceptedAt })
      .from(leadOffers)
      .where(and(inArray(leadOffers.leadId, ids), eq(leadOffers.status, 'accepted')));
    const bestAt = new Map<number, number>();
    for (const o of offers) {
      const t = o.acceptedAt ? o.acceptedAt.getTime() : 0;
      if (!bestAt.has(o.leadId) || t >= (bestAt.get(o.leadId) ?? 0)) {
        bestAt.set(o.leadId, t);
        agentByLead.set(o.leadId, o.agentId);
      }
    }
  }

  const agentIds = Array.from(new Set(Array.from(agentByLead.values())));
  const nameById = new Map<number, string>();
  if (agentIds.length > 0) {
    const rows = await db
      .select({ id: agents.id, first: agents.firstName, last: agents.lastName })
      .from(agents)
      .where(inArray(agents.id, agentIds));
    for (const a of rows) nameById.set(a.id, `${a.first} ${a.last}`.trim() || `Agent #${a.id}`);
  }

  // Aggregate.
  const overall = new Map<string, number>();
  interface AgentAgg {
    id: number;
    name: string;
    total: number;
    byReason: Map<string, number>;
  }
  const perAgent = new Map<number, AgentAgg>();
  const UNASSIGNED = -1;

  for (const l of lost) {
    const reason = l.reason ?? 'other';
    overall.set(reason, (overall.get(reason) ?? 0) + 1);
    const aId = agentByLead.get(l.id) ?? UNASSIGNED;
    let agg = perAgent.get(aId);
    if (!agg) {
      agg = { id: aId, name: aId === UNASSIGNED ? 'Unassigned' : nameById.get(aId) ?? `Agent #${aId}`, total: 0, byReason: new Map() };
      perAgent.set(aId, agg);
    }
    agg.total += 1;
    agg.byReason.set(reason, (agg.byReason.get(reason) ?? 0) + 1);
  }

  const totalLost = lost.length;
  const maxReason = Math.max(1, ...LOST_REASONS.map((r) => overall.get(r) ?? 0));

  // Agents ranked by "unresponsive" share (signal first), among those with enough Lost.
  const ranked = Array.from(perAgent.values())
    .filter((a) => a.id !== UNASSIGNED && a.total >= MIN_LOST_FOR_SIGNAL)
    .map((a) => ({ ...a, unresponsive: a.byReason.get('unresponsive') ?? 0 }))
    .map((a) => ({ ...a, unresponsivePct: a.total > 0 ? a.unresponsive / a.total : 0 }))
    .sort((a, b) => b.unresponsivePct - a.unresponsivePct || b.total - a.total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Lost reasons</h1>
        <p className="text-sm text-mute">
          {totalLost} lead{totalLost === 1 ? '' : 's'} marked Lost. Marking Lost carries no score
          penalty, so watch the reason mix — an unusually high &ldquo;{lostReasonLabel('unresponsive')}
          &rdquo; rate for one agent is worth a human look.
        </p>
      </div>

      {/* Overall breakdown */}
      <div className="rounded-card border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-bold text-charcoal">By reason (all agents)</h2>
        </div>
        <div className="space-y-3 px-5 py-5">
          {totalLost === 0 ? (
            <p className="text-sm text-mute">No leads have been marked Lost yet.</p>
          ) : (
            LOST_REASONS.map((r) => {
              const n = overall.get(r) ?? 0;
              const pct = totalLost > 0 ? Math.round((n / totalLost) * 100) : 0;
              return (
                <div key={r} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-sm text-charcoal">{lostReasonLabel(r)}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line-hair">
                    <div
                      className={`h-full rounded-full ${r === 'unresponsive' ? 'bg-warning' : 'bg-platinum-blue'}`}
                      style={{ width: `${Math.round(((n || 0) / maxReason) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-sm text-mute">
                    {n} · {pct}%
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Per-agent signal table */}
      <div className="rounded-card border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-bold text-charcoal">By agent</h2>
          <p className="text-xs text-mute-light">
            Agents with {MIN_LOST_FOR_SIGNAL}+ Lost, ranked by unresponsive share. A highlighted row
            is ≥ {Math.round(UNRESPONSIVE_FLAG * 100)}% unresponsive.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                <th className="px-4 py-3 text-left">Agent</th>
                <th className="px-4 py-3 text-right">Lost</th>
                {LOST_REASONS.map((r) => (
                  <th key={r} className="px-3 py-3 text-right">
                    {lostReasonLabel(r)}
                  </th>
                ))}
                <th className="px-4 py-3 text-right">Unresp. %</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={LOST_REASONS.length + 3} className="px-4 py-10 text-center text-mute">
                    No agent has {MIN_LOST_FOR_SIGNAL}+ Lost leads yet.
                  </td>
                </tr>
              ) : (
                ranked.map((a) => {
                  const flagged = a.unresponsivePct >= UNRESPONSIVE_FLAG;
                  return (
                    <tr
                      key={a.id}
                      className={`border-b border-line-hair last:border-0 ${flagged ? 'bg-warning-bg' : 'hover:bg-offwhite'}`}
                    >
                      <td className="px-4 py-2.5 font-semibold text-charcoal">
                        <Link href={`/admin/agents/${a.id}`} className="hover:text-platinum-red">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-numeric">{a.total}</td>
                      {LOST_REASONS.map((r) => (
                        <td key={r} className="px-3 py-2.5 text-right font-numeric text-mute">
                          {a.byReason.get(r) ?? 0}
                        </td>
                      ))}
                      <td
                        className={`px-4 py-2.5 text-right font-numeric font-bold ${flagged ? 'text-platinum-red' : 'text-charcoal'}`}
                      >
                        {Math.round(a.unresponsivePct * 100)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
