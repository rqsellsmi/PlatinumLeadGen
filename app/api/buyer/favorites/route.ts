/**
 * Buyer favorites API. All handlers require a verified buyer session and scope
 * every query to that buyer's id — a signed-out request gets 401, and there is
 * no way to reference another buyer's rows. Same-origin guarded in middleware.
 *
 *   GET    → { favorites: string[] }   the buyer's favorited listing keys
 *   POST   { listingKey }              add a favorite (idempotent)
 *   DELETE { listingKey }              remove a favorite
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuyerUserId } from '@/lib/buyerSession';
import { addFavorite, listFavoriteKeys, removeFavorite } from '@/lib/buyerSaves';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const k = v.trim();
  return k && k.length <= 100 ? k : null;
}

export async function GET() {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ favorites: await listFavoriteKeys(buyerId) });
}

export async function POST(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const listingKey = cleanKey(body?.listingKey);
  if (!listingKey) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await addFavorite(buyerId, listingKey);
  return NextResponse.json({ ok: true, favorited: true });
}

export async function DELETE(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const listingKey = cleanKey(body?.listingKey);
  if (!listingKey) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await removeFavorite(buyerId, listingKey);
  return NextResponse.json({ ok: true, favorited: false });
}
