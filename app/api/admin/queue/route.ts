/**
 * GET /api/admin/queue — current persisted rotation + pointer + agent summaries.
 * (v1.6 §G.4)
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { getActiveRoutingAgents } from '@/lib/autoOffer';
import { getRoutingQueue } from '@/lib/queue';
import { slotCountForScore } from '@/lib/routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const available = await getActiveRoutingAgents();
  const { rotationList, pointer } = await getRoutingQueue(available);

  const agentRows = await db
    .select({ id: agents.id, first: agents.firstName, last: agents.lastName, score: agents.scoreRolling90d })
    .from(agents);
  const summary = agentRows.map((a) => ({
    id: a.id,
    name: `${a.first} ${a.last}`.trim(),
    score: a.score ?? 0,
    slots: slotCountForScore(a.score ?? 0),
  }));

  return NextResponse.json({ rotationList, pointer, agents: summary });
}
