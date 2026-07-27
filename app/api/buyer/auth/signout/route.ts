/** POST /api/buyer/auth/signout — clear the buyer session. */
import { NextResponse } from 'next/server';
import { clearBuyerSessionCookie } from '@/lib/buyerSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await clearBuyerSessionCookie();
  return NextResponse.json({ ok: true });
}
