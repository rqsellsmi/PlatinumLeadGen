/**
 * POST /api/agent/availability — agent self-controlled lead routing toggle.
 * (Section 16.5)  Body: { available: boolean }. Auth: agent session cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAgent } from '@/lib/agentSession';
import { setAgentAvailability } from '@/lib/agentAvailability';

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
  // Same shared path the admin toggle uses.
  await setAgentAvailability(agent.id, body.available);
  return NextResponse.json({ success: true, isAvailable: body.available });
}
