/**
 * POST /api/agent/availability — agent self-controlled lead routing toggle.
 * (Section 16.5)  Body: { available: boolean }. Auth: agent session cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const agent = await getCurrentAgent();
  if (!agent) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { available?: boolean } | null;
  if (typeof body?.available !== 'boolean') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  await db
    .update(agents)
    .set({ isAvailable: body.available, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));
  return NextResponse.json({ success: true, isAvailable: body.available });
}
