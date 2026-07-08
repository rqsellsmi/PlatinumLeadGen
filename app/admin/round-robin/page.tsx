import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import QueueEditor, { type QueueSlot, type DistRow } from '@/components/admin/QueueEditor';
import { getActiveRoutingAgents } from '@/lib/autoOffer';
import { getRoutingQueue } from '@/lib/queue';
import { slotCountForScore } from '@/lib/routing';
import { distributionThisWeek, AVATAR_COLORS } from '@/lib/roundRobin';

export const dynamic = 'force-dynamic';

export default async function RoundRobinPage() {
  await requireAdmin();

  const available = await getActiveRoutingAgents();
  const [{ rotationList, pointer }, dist, agentRows] = await Promise.all([
    getRoutingQueue(available),
    distributionThisWeek(),
    db
      .select({ id: agents.id, first: agents.firstName, last: agents.lastName, score: agents.scoreRolling365 })
      .from(agents),
  ]);

  const nameById = new Map(agentRows.map((a) => [a.id, `${a.first} ${a.last}`.trim() || `Agent #${a.id}`]));
  const scoreById = new Map(agentRows.map((a) => [a.id, a.score ?? 0]));

  // Expand the rotation into draggable slot rows, numbering each agent's slots.
  const totalByAgent = new Map<number, number>();
  rotationList.forEach((id) => totalByAgent.set(id, (totalByAgent.get(id) ?? 0) + 1));
  const seen = new Map<number, number>();
  const slots: QueueSlot[] = rotationList.map((id, i) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return {
      key: `${id}-${i}`,
      agentId: id,
      agentName: nameById.get(id) ?? `Agent #${id}`,
      score: scoreById.get(id) ?? 0,
      slotIndex: n,
      slotCount: totalByAgent.get(id) ?? slotCountForScore(scoreById.get(id) ?? 0),
    };
  });

  const maxDist = Math.max(1, ...agentRows.map((a) => dist.get(a.id) ?? 0));
  const distribution: DistRow[] = agentRows.map((a, i) => {
    const count = dist.get(a.id) ?? 0;
    return {
      name: `${a.first} ${a.last}`.trim() || `Agent #${a.id}`,
      count,
      pct: Math.round((count / maxDist) * 100),
      color: AVATAR_COLORS[i % AVATAR_COLORS.length],
    };
  });

  return <QueueEditor initialSlots={slots} pointer={pointer} distribution={distribution} />;
}
