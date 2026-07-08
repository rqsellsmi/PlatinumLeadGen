import { asc, eq, sql, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices, leadOffers, leads } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import AgentDirectory, { type AgentRow } from '@/components/admin/AgentDirectory';
import { tierFor } from '@/lib/scoreTiers';
import { loadTierContext } from '@/lib/scoreTiersServer';
import { createAgent } from './actions';

export const dynamic = 'force-dynamic';

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
  const tierCtx = await loadTierContext();

  // Build serializable rows (with precomputed metrics) for the client directory.
  const agentRows: AgentRow[] = rows.map(({ agent, officeName, officeCity }) => {
    const accepted = acceptedById.get(agent.id) ?? 0;
    return {
      id: agent.id,
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email,
      officeName: officeName ?? null,
      officeCity: officeCity ?? null,
      isActive: agent.isActive,
      score: agent.scoreLifetime, // directory shows lifetime + its cohort tier (spec v2 §6)
      tierLabel: tierFor(agent.scoreLifetime, tierCtx).label,
      tierColor: tierFor(agent.scoreLifetime, tierCtx).color,
      activeLeads: activeById.get(agent.id) ?? 0,
      conversionPct:
        accepted === 0 ? null : Math.round(((closedById.get(agent.id) ?? 0) / accepted) * 100),
      avgResponseMins: respById.get(agent.id) ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Agents</h1>
        <p className="text-sm text-mute">{rows.length} agents.</p>
      </div>

      {agentRows.length === 0 ? (
        <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
          No agents yet.
        </div>
      ) : (
        <AgentDirectory agents={agentRows} />
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
