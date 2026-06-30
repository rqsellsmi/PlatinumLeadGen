import { redirect } from 'next/navigation';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agentLeadOrder } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { Card, CardBody } from '@/components/ui';
import { LeadList, type LeadListItem } from '@/components/agent/LeadList';

export const dynamic = 'force-dynamic';

export default async function AgentLeadsPage() {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  // Accepted offers for this agent, joined to leads, ordered by saved
  // drag-and-drop position (nulls last) then most-recently-accepted first.
  const rows = await db
    .select({
      leadOfferId: leadOffers.id,
      status: leads.status,
      acceptedAt: leadOffers.acceptedAt,
      firstName: leads.firstName,
      lastName: leads.lastName,
      propertyAddress: leads.propertyAddress,
      propertyCity: leads.propertyCity,
      propertyState: leads.propertyState,
      propertyZip: leads.propertyZip,
      position: agentLeadOrder.position,
    })
    .from(leadOffers)
    .innerJoin(leads, eq(leadOffers.leadId, leads.id))
    .leftJoin(
      agentLeadOrder,
      and(
        eq(agentLeadOrder.leadOfferId, leadOffers.id),
        eq(agentLeadOrder.agentId, agent.id),
      ),
    )
    .where(and(eq(leadOffers.agentId, agent.id), eq(leadOffers.status, 'accepted')))
    .orderBy(
      sql`${agentLeadOrder.position} asc nulls last`,
      desc(leadOffers.acceptedAt),
    );

  const now = Date.now();
  const items: LeadListItem[] = rows.map((r) => {
    const name = [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unnamed lead';
    const address =
      [r.propertyAddress, r.propertyCity, r.propertyState, r.propertyZip]
        .filter(Boolean)
        .join(', ') || null;
    const daysSinceAccepted =
      r.acceptedAt != null
        ? Math.floor((now - new Date(r.acceptedAt).getTime()) / 86_400_000)
        : null;
    return {
      leadOfferId: r.leadOfferId,
      name,
      address,
      status: r.status,
      daysSinceAccepted,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My leads</h1>
        <p className="text-sm text-slate-500">
          Drag to reorder. Your custom order is saved automatically.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-center text-sm text-slate-500">
              You have no accepted leads yet.
            </p>
          </CardBody>
        </Card>
      ) : (
        <LeadList items={items} />
      )}
    </div>
  );
}
