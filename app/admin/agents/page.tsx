import Link from 'next/link';
import { asc, eq, sql, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices, leadOffers, leads } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import { scoreTier } from '@/lib/scoreTiers';
import { createAgent, toggleAgentActive } from './actions';

export const dynamic = 'force-dynamic';

function initials(first: string | null, last: string | null): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

const AVATAR_BG = ['bg-platinum-blue', 'bg-platinum-red', 'bg-charcoal', 'bg-brandpurple', 'bg-success'];

export default async function AgentsPage() {
  await requireAdmin();

  const [rows, officeList, activeCounts, acceptedCounts, closedCounts, respRows] = await Promise.all([
    db
      .select({ agent: agents, officeName: offices.name, officeCity: offices.city })
      .from(agents)
      .leftJoin(offices, eq(agents.officeId, offices.id))
      .orderBy(asc(agents.lastName), asc(agents.firstName)),
    db.select().from(offices).where(eq(offices.isActive, true)).orderBy(asc(offices.name)),
    // Currently-open (accepted, not yet closed/lost) leads per agent.
    db
      .select({ agentId: leadOffers.agentId, n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .where(and(eq(leadOffers.status, 'accepted'), sql`${leads.status} not in ('closed','lost')`))
      .groupBy(leadOffers.agentId),
    // Every accepted offer per agent (denominator for conversion).
    db
      .select({ agentId: leadOffers.agentId, n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .where(eq(leadOffers.status, 'accepted'))
      .groupBy(leadOffers.agentId),
    // Accepted offers whose lead reached "closed" (numerator for conversion).
    db
      .select({ agentId: leadOffers.agentId, n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .where(and(eq(leadOffers.status, 'accepted'), eq(leads.status, 'closed')))
      .groupBy(leadOffers.agentId),
    // Average accept latency (minutes) per agent.
    db
      .select({
        agentId: leadOffers.agentId,
        mins: sql<number | null>`avg(extract(epoch from (${leadOffers.acceptedAt} - ${leadOffers.offerSentAt}))/60)`,
      })
      .from(leadOffers)
      .where(eq(leadOffers.status, 'accepted'))
      .groupBy(leadOffers.agentId),
  ]);

  const activeById = new Map(activeCounts.map((r) => [r.agentId, Number(r.n)]));
  const acceptedById = new Map(acceptedCounts.map((r) => [r.agentId, Number(r.n)]));
  const closedById = new Map(closedCounts.map((r) => [r.agentId, Number(r.n)]));
  const respById = new Map(respRows.map((r) => [r.agentId, r.mins != null ? Number(r.mins) : null]));

  function conversionPct(agentId: number): string {
    const acc = acceptedById.get(agentId) ?? 0;
    if (acc === 0) return '—';
    return `${Math.round(((closedById.get(agentId) ?? 0) / acc) * 100)}%`;
  }
  function avgResponse(agentId: number): string {
    const m = respById.get(agentId);
    if (m == null) return '—';
    return m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Agents</h1>
        <p className="text-sm text-mute">{rows.length} agents.</p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
          No agents yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ agent, officeName, officeCity }, i) => {
            const tier = scoreTier(agent.score);
            return (
              <div key={agent.id} className="rounded-card border border-line bg-white p-5">
                <div className="flex items-center gap-3.5">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_BG[i % AVATAR_BG.length]}`}
                  >
                    {initials(agent.firstName, agent.lastName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/agents/${agent.id}`}
                      className="block truncate font-bold text-charcoal hover:text-platinum-red"
                    >
                      {agent.firstName} {agent.lastName}
                    </Link>
                    <p className="truncate text-[13px] text-mute-light">
                      {[officeName, officeCity].filter(Boolean).join(' · ') || agent.email}
                    </p>
                  </div>
                  <Badge tone={agent.isActive ? 'success' : 'neutral'}>
                    {agent.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  <div className="rounded-lg bg-offwhite p-3">
                    <p className="font-numeric text-2xl font-bold leading-none text-charcoal">
                      {activeById.get(agent.id) ?? 0}
                    </p>
                    <p className="mt-1 text-[11px] text-mute-light">Active leads</p>
                  </div>
                  <div className="rounded-lg bg-offwhite p-3">
                    <p className="font-numeric text-2xl font-bold leading-none text-success">
                      {conversionPct(agent.id)}
                    </p>
                    <p className="mt-1 text-[11px] text-mute-light">Conversion</p>
                  </div>
                  <div className="rounded-lg bg-offwhite p-3">
                    <p className="font-numeric text-2xl font-bold leading-none text-charcoal">
                      {avgResponse(agent.id)}
                    </p>
                    <p className="mt-1 text-[11px] text-mute-light">Avg response</p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-mute-light">
                  Score <span className="font-bold text-charcoal">{Math.round(agent.score)}</span> ·{' '}
                  <span className={`font-bold ${tier.color}`}>{tier.label}</span>
                </p>

                <div className="mt-4 flex gap-2.5">
                  <form action={toggleAgentActive} className="flex-1">
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="isActive" value={String(agent.isActive)} />
                    <Button type="submit" size="sm" variant="outline" className="w-full">
                      {agent.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </form>
                  <Link href={`/admin/agents/${agent.id}`} className="flex-1">
                    <Button type="button" variant="secondary" size="sm" className="w-full">
                      View profile
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Add agent</h2>
        </CardHeader>
        <CardBody>
          <ResetOnSubmitForm action={createAgent} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
            <div>
              <Label htmlFor="officeId">Office</Label>
              <Select id="officeId" name="officeId" defaultValue="">
                <option value="">None</option>
                {officeList.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lat">Latitude</Label>
                <Input id="lat" name="lat" type="number" step="any" />
              </div>
              <div>
                <Label htmlFor="lng">Longitude</Label>
                <Input id="lng" name="lng" type="number" step="any" />
              </div>
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Add agent</Button>
            </div>
          </ResetOnSubmitForm>
        </CardBody>
      </Card>
    </div>
  );
}
