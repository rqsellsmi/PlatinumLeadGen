import Link from 'next/link';
import { asc, eq, sql, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices, leadOffers } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { scoreTier } from '@/lib/scoreTiers';
import { createAgent, toggleAgentActive } from './actions';

export const dynamic = 'force-dynamic';

function initials(first: string | null, last: string | null): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

const AVATAR_BG = ['bg-platinum-blue', 'bg-platinum-red', 'bg-charcoal', 'bg-brandpurple', 'bg-success'];

export default async function AgentsPage() {
  await requireAdmin();

  const [rows, officeList, activeCounts] = await Promise.all([
    db
      .select({ agent: agents, officeName: offices.name, officeCity: offices.city })
      .from(agents)
      .leftJoin(offices, eq(agents.officeId, offices.id))
      .orderBy(asc(agents.lastName), asc(agents.firstName)),
    db.select().from(offices).where(eq(offices.isActive, true)).orderBy(asc(offices.name)),
    db
      .select({ agentId: leadOffers.agentId, n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .where(eq(leadOffers.status, 'accepted'))
      .groupBy(leadOffers.agentId),
  ]);

  const activeById = new Map(activeCounts.map((r) => [r.agentId, Number(r.n)]));

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
                      {Math.round(agent.score)}
                    </p>
                    <p className="mt-1 text-[11px] text-mute-light">Score</p>
                  </div>
                  <div className="rounded-lg bg-offwhite p-3">
                    <p className="font-numeric text-2xl font-bold leading-none text-charcoal">
                      {activeById.get(agent.id) ?? 0}
                    </p>
                    <p className="mt-1 text-[11px] text-mute-light">Active leads</p>
                  </div>
                  <div className="rounded-lg bg-offwhite p-3">
                    <p className={`text-sm font-bold leading-tight ${tier.color}`}>{tier.label}</p>
                    <p className="mt-1 text-[11px] text-mute-light">Tier</p>
                  </div>
                </div>

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
          <form action={createAgent} className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
