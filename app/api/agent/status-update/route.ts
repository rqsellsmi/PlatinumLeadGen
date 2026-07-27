/**
 * POST /api/agent/status-update — agent submits a pipeline status update. (Section 9)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAgent } from '@/lib/agentSession';
import { recordStatusUpdate } from '@/lib/statusUpdates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const agent = await getCurrentAgent();
    if (!agent) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { leadOfferId?: number; newStatus?: string; note?: string; lostReason?: string }
      | null;
    if (!body || typeof body.leadOfferId !== 'number' || typeof body.newStatus !== 'string') {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const r = await recordStatusUpdate({
      agentId: agent.id,
      leadOfferId: body.leadOfferId,
      newStatus: body.newStatus,
      note: body.note,
      lostReason: body.lostReason,
      source: 'web',
    });

    if (r.ok) {
      return NextResponse.json({ success: true });
    }

    switch (r.reason) {
      case 'invalid-status':
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
      case 'invalid-transition':
        return NextResponse.json({ error: 'invalid_transition' }, { status: 400 });
      case 'offer-not-found':
        return NextResponse.json({ error: 'offer_not_found' }, { status: 404 });
      case 'lost-reason-required':
        return NextResponse.json({ error: 'lost_reason_required' }, { status: 400 });
      default:
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
  } catch (err) {
    console.error('[api/agent/status-update] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
