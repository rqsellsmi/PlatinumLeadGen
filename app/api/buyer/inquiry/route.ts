/**
 * POST /api/buyer/inquiry — a buyer "schedule a showing" or "contact an agent"
 * request on a listing. Creates/attaches a buyer lead (intent='buyer') and routes
 * it through the existing pipeline. Same-origin guarded in middleware.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buyerInquirySchema } from '@/lib/validation';
import { createBuyerInquiry } from '@/lib/buyerInquiry';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'lead_submit'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = buyerInquirySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await createBuyerInquiry(parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason ?? 'error' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/buyer/inquiry] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
