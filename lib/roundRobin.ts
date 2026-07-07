/**
 * Shared data helpers for the admin Overview and Round-Robin views.
 * Weight comes from the score-weighted rotation (slotCountForScore); "next up"
 * is the agent at the persisted queue pointer among available agents.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { agents, offices, leadOffers, leads } from '../drizzle/schema';
import { buildRotationList, slotCountForScore } from './routing';
import { readQueue } from './queue';

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export const AVATAR_COLORS = [
  'bg-platinum-blue',
  'bg-success',
  'bg-warning',
  'bg-platinum-redHover',
  'bg-charcoal-light',
  'bg-platinum-red',
];

export interface RotationAgent {
  id: number;
  name: string;
  initials: string;
  score: number;
  isAvailable: boolean;
  weight: number;
  activeLeads: number;
}

export interface RoutingSnapshot {
  agents: RotationAgent[]; // all active agents (paused included)
  nextAgentId: number | null;
  waiting: number; // unassigned leads
}

/** Count of non-deleted leads with no accepted offer (unassigned). */
async function unassignedCount(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.isDeleted, false),
        sql`not exists (select 1 from ${leadOffers} lo where lo.lead_id = ${leads.id} and lo.status = 'accepted')`,
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function getRoutingSnapshot(): Promise<RoutingSnapshot> {
  try {
    const agentRows = await db
      .select({
        id: agents.id,
        first: agents.firstName,
        last: agents.lastName,
        score: agents.score,
        isAvailable: agents.isAvailable,
      })
      .from(agents)
      .where(eq(agents.isActive, true));

    // Active accepted leads per agent.
    const activeRows = await db
      .select({ agentId: leadOffers.agentId, n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .where(eq(leadOffers.status, 'accepted'))
      .groupBy(leadOffers.agentId);
    const activeMap = new Map(activeRows.map((r) => [r.agentId, Number(r.n)]));

    const agentsOut: RotationAgent[] = agentRows.map((a) => {
      const name = [a.first, a.last].filter(Boolean).join(' ') || `Agent #${a.id}`;
      return {
        id: a.id,
        name,
        initials: initialsOf(name),
        score: a.score ?? 0,
        isAvailable: a.isAvailable,
        weight: slotCountForScore(a.score ?? 0),
        activeLeads: activeMap.get(a.id) ?? 0,
      };
    });

    // Next up: the front of the persisted queue among AVAILABLE agents (the
    // list is self-ordering — front = next). Fall back to a freshly built
    // rotation if the queue hasn't been persisted yet.
    const available = agentsOut
      .filter((a) => a.isAvailable)
      .map((a) => ({ id: a.id, lat: null, lng: null, score: a.score }));
    const availSet = new Set(available.map((a) => a.id));
    let nextAgentId: number | null = null;
    const persisted = await readQueue();
    if (persisted && persisted.rotationList.length > 0) {
      nextAgentId = persisted.rotationList.find((id) => availSet.has(id)) ?? null;
    }
    if (nextAgentId == null) {
      const rotation = buildRotationList(available);
      nextAgentId = rotation.length > 0 ? rotation[0] : null;
    }

    return { agents: agentsOut, nextAgentId, waiting: await unassignedCount() };
  } catch (err) {
    console.warn('[roundRobin] snapshot failed:', err);
    return { agents: [], nextAgentId: null, waiting: 0 };
  }
}

/** Offers created in the last 7 days per agent (distribution this week). */
export async function distributionThisWeek(): Promise<Map<number, number>> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ agentId: leadOffers.agentId, n: sql<number>`count(*)::int` })
      .from(leadOffers)
      .where(gte(leadOffers.createdAt, since))
      .groupBy(leadOffers.agentId);
    return new Map(rows.map((r) => [r.agentId, Number(r.n)]));
  } catch {
    return new Map();
  }
}

export { offices };
