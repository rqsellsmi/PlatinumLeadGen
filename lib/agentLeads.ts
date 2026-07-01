/**
 * Shared loader for an agent's accepted leads. Used by both the "My Leads"
 * dashboard and the Pipeline (kanban) view so they present identical data.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { leads, leadOffers, agentLeadOrder } from '../drizzle/schema';
import { formatPriceRange, relativeTime } from './utils';

export type AgentLeadStatus = 'new' | 'contacted' | 'qualified' | 'closed' | 'lost';

export interface AgentLeadRow {
  leadOfferId: number;
  name: string;
  address: string | null;
  status: AgentLeadStatus;
  priceRange: string | null;
  timeframe: string | null;
  agoLabel: string | null;
  daysSinceAccepted: number | null;
}

export async function loadAgentAcceptedLeads(agentId: number): Promise<AgentLeadRow[]> {
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
      and(eq(agentLeadOrder.leadOfferId, leadOffers.id), eq(agentLeadOrder.agentId, agentId)),
    )
    .where(and(eq(leadOffers.agentId, agentId), eq(leadOffers.status, 'accepted')))
    .orderBy(sql`${agentLeadOrder.position} asc nulls last`, desc(leadOffers.acceptedAt));

  return rows.map((r) => ({
    leadOfferId: r.leadOfferId,
    name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unnamed lead',
    address: [r.propertyAddress, r.propertyCity].filter(Boolean).join(', ') || null,
    status: r.status as AgentLeadStatus,
    priceRange: formatPriceRange(r.priceRangeLow, r.priceRangeHigh, r.estimatedValue),
    timeframe: r.timeframe,
    agoLabel: relativeTime(r.acceptedAt ?? r.offerSentAt),
    daysSinceAccepted:
      r.acceptedAt != null
        ? Math.floor((Date.now() - new Date(r.acceptedAt).getTime()) / 86_400_000)
        : null,
  }));
}
