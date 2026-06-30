import { requireAdmin } from '@/components/admin/requireAdmin';
import RoundRobinView, { type RotationRow, type DistRow } from '@/components/admin/RoundRobinView';
import { getRoutingSnapshot, distributionThisWeek, AVATAR_COLORS } from '@/lib/roundRobin';

export const dynamic = 'force-dynamic';

const DIST_COLORS = ['bg-platinum-blue', 'bg-success', 'bg-warning', 'bg-platinum-redHover'];

export default async function RoundRobinPage() {
  await requireAdmin();

  const [snapshot, dist] = await Promise.all([getRoutingSnapshot(), distributionThisWeek()]);

  // Rank available agents; paused agents get rank null (shown as —).
  let rank = 0;
  const rotation: RotationRow[] = snapshot.agents.map((a, i) => ({
    rank: a.isAvailable ? ++rank : null,
    name: a.name,
    initials: a.initials,
    color: AVATAR_COLORS[i % AVATAR_COLORS.length],
    activeLeads: a.activeLeads,
    weight: a.weight,
    paused: !a.isAvailable,
    nextUp: a.id === snapshot.nextAgentId,
  }));

  const next = snapshot.agents.find((a) => a.id === snapshot.nextAgentId) ?? null;

  const maxDist = Math.max(1, ...snapshot.agents.map((a) => dist.get(a.id) ?? 0));
  const distribution: DistRow[] = snapshot.agents.map((a, i) => {
    const count = dist.get(a.id) ?? 0;
    return {
      name: a.name,
      count,
      pct: Math.round((count / maxDist) * 100),
      color: DIST_COLORS[i % DIST_COLORS.length],
    };
  });

  return (
    <RoundRobinView
      rotation={rotation}
      nextAgent={next ? { name: next.name, initials: next.initials, waiting: snapshot.waiting } : null}
      distribution={distribution}
    />
  );
}
