/**
 * POST /api/agent/reorder — persist the agent's drag-and-drop lead ordering. (Section 9)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentLeadOrder } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const agent = await getCurrentAgent();
    if (!agent) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as { order?: number[] } | null;
    if (!body || !Array.isArray(body.order) || !body.order.every((n) => typeof n === 'number')) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    for (let i = 0; i < body.order.length; i += 1) {
      const leadOfferId = body.order[i];
      await db
        .insert(agentLeadOrder)
        .values({ agentId: agent.id, leadOfferId, position: i })
        .onConflictDoUpdate({
          target: [agentLeadOrder.agentId, agentLeadOrder.leadOfferId],
          set: { position: i },
        });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/reorder] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
