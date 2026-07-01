/**
 * POST /api/valuation — RentCast AVM proxy with per-IP rate limiting,
 * enriched usage logging, and a monthly free-tier quota alert. (Section 4.7 + v1.6 §H)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiUsageLogs } from '@/drizzle/schema';
import { valuationSchema } from '@/lib/validation';
import { getValuation, type ValuationResult } from '@/lib/rentcast';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { sendEmail, rentcastQuotaAlertEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FREE_TIER_LIMIT = 50;
const ALERT_AT = 40; // fire once when the 40th call of the month is logged (§H.3)

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    if (!(await checkPreset(ip, 'valuation'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = valuationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const address = parsed.data.address;
    const start = Date.now();
    let result: ValuationResult | null = null;
    let success = true;
    let errorMessage: string | null = null;
    try {
      result = await getValuation(address);
    } catch (err) {
      success = false;
      errorMessage = err instanceof Error ? err.message : 'valuation error';
    }
    const responseTimeMs = Date.now() - start;

    await db.insert(apiUsageLogs).values({
      service: 'rentcast',
      endpoint: '/avm/value',
      ip,
      statusCode: success ? 200 : 502,
      propertyAddress: address,
      estimatedValue: result?.estimatedValue ?? null,
      priceRangeLow: result?.priceRangeLow ?? null,
      priceRangeHigh: result?.priceRangeHigh ?? null,
      success,
      errorMessage,
      responseTimeMs,
    });

    // Monthly quota alert — fire exactly once when the 40th call lands (§H.3).
    if (success) {
      try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const countRows = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(apiUsageLogs)
          .where(and(eq(apiUsageLogs.service, 'rentcast'), gte(apiUsageLogs.createdAt, monthStart)));
        if (Number(countRows[0]?.n ?? 0) === ALERT_AT) {
          await sendEmail(rentcastQuotaAlertEmail(ALERT_AT, FREE_TIER_LIMIT));
        }
      } catch (err) {
        console.error('[api/valuation] quota alert failed:', err);
      }
    }

    // Always 200 — the form shows a graceful fallback when values are null.
    return NextResponse.json({
      estimatedValue: result?.estimatedValue ?? null,
      priceRangeLow: result?.priceRangeLow ?? null,
      priceRangeHigh: result?.priceRangeHigh ?? null,
    });
  } catch (err) {
    console.error('[api/valuation] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
