/**
 * POST /api/buyer/track-view — record that the signed-in buyer viewed a listing.
 * No-op (204) for signed-out visitors, so the client can fire it unconditionally.
 * Same-origin guarded in middleware. Recording a view never creates a lead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuyerUserId } from '@/lib/buyerSession';
import { recordListingView } from '@/lib/buyerSaves';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return new NextResponse(null, { status: 204 });

  const body = await req.json().catch(() => null);
  const listingKey = typeof body?.listingKey === 'string' ? body.listingKey.trim() : '';
  if (!listingKey || listingKey.length > 100) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    await recordListingView(buyerId, listingKey);
  } catch {
    /* best-effort; never surface a tracking failure */
  }
  return new NextResponse(null, { status: 204 });
}
