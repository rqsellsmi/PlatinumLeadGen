/** GET /api/buyer/me — lightweight session status for the header/modal. */
import { NextResponse } from 'next/server';
import { getCurrentBuyer } from '@/lib/buyerSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const buyer = await getCurrentBuyer();
  if (!buyer) return NextResponse.json({ signedIn: false });
  return NextResponse.json({
    signedIn: true,
    name: buyer.name ?? null,
    email: buyer.email,
  });
}
