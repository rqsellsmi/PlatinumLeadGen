/**
 * POST /api/admin/queue/rebuild — recompute the rotation from current agent
 * scores/slots and persist. (v1.6 §G.4)
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getActiveRoutingAgents } from '@/lib/autoOffer';
import { rebuildQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const available = await getActiveRoutingAgents();
  const { rotationList, pointer } = await rebuildQueue(available);
  return NextResponse.json({ ok: true, rotationList, pointer });
}
