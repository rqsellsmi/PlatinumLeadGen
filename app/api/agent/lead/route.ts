/**
 * POST /api/agent/lead — agent edits the contact details on a lead they own.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAgent } from '@/lib/agentSession';
import { updateLeadContactInfo } from '@/lib/agentLeadEdit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const agent = await getCurrentAgent();
    if (!agent) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const r = await updateLeadContactInfo(agent.id, body);

    if (r.ok) {
      return NextResponse.json({ success: true });
    }

    switch (r.reason) {
      case 'invalid':
        return NextResponse.json({ error: 'invalid_request', message: r.message }, { status: 400 });
      case 'not-owned':
        return NextResponse.json({ error: 'not_owned' }, { status: 404 });
      default:
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
  } catch (err) {
    console.error('[api/agent/lead] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
