/**
 * POST /api/admin/leads/[leadId]/reassign — manual lead reassignment.
 * (Section 18.5)  Body: { agentId: number }. Auth: NextAuth admin session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { manualReassignLead } from '@/lib/autoOffer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { leadId: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const leadId = Number(params.leadId);
  const body = (await req.json().catch(() => null)) as { agentId?: number } | null;
  if (!leadId || typeof body?.agentId !== 'number') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await manualReassignLead(leadId, body.agentId, session.user.name ?? 'admin');
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'reassign_failed' }, { status: 400 });
  }
  revalidatePath(`/admin/leads/${leadId}`);
  return NextResponse.json({
    success: true,
    newOfferId: result.newOfferId,
    previousOfferClosed: result.previousOfferClosed,
  });
}
