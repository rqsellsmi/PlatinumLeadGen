/**
 * POST /api/valuation — RentCast AVM proxy with per-IP rate limiting. (Section 4.7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiUsageLogs } from '@/drizzle/schema';
import { valuationSchema } from '@/lib/validation';
import { getValuation } from '@/lib/rentcast';
import { valuationRateLimit, clientIp } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const { success } = await valuationRateLimit.limit(ip);
    if (!success) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = valuationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await getValuation(parsed.data.address);

    await db.insert(apiUsageLogs).values({
      endpoint: '/api/valuation',
      ip,
      statusCode: 200,
    });

    return NextResponse.json({
      estimatedValue: result.estimatedValue,
      priceRangeLow: result.priceRangeLow,
      priceRangeHigh: result.priceRangeHigh,
    });
  } catch (err) {
    console.error('[api/valuation] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
