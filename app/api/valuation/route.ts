/**
 * POST /api/valuation — valuation-provider proxy (RentCast or ATTOM, chosen by
 * the VALUATION_PROVIDER runtime flag) with per-IP rate limiting, usage
 * logging, and a monthly free-tier quota alert (RentCast only).
 *
 * Two-tier gating: the full result is stored server-side (lib/valuationStore)
 * and only the widened ±8% teaser range + property basics + an opaque token are
 * returned to the browser. The precise estimate and detail are revealed on the
 * report page after the visitor gives contact info. (Section 4.7 + v1.6 §H)
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiUsageLogs, leads } from '@/drizzle/schema';
import { valuationSchema } from '@/lib/validation';
import { getValuation, activeProvider, type ValuationResult } from '@/lib/valuation';
import { storeValuation } from '@/lib/valuationStore';
import { normalizeAddress } from '@/lib/addressNormalization';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { sendEmail, rentcastQuotaAlertEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FREE_TIER_LIMIT = 50;
const ALERT_AT = 40; // fire once when the 40th RentCast call of the month lands (§H.3)

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
    const provider = activeProvider();
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

    // Log against whichever provider actually answered (falls back to flag).
    const service = result?.provider ?? provider;
    await db.insert(apiUsageLogs).values({
      service,
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

    // Monthly quota alert — RentCast free tier only (§H.3).
    if (success && service === 'rentcast') {
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

    // No usable estimate → tell the client to show the graceful fallback.
    if (!result || result.estimatedValue == null) {
      return NextResponse.json({ token: null, rangeLow: null, rangeHigh: null, basics: null });
    }

    // Store the full result server-side; return only the gated teaser.
    const token = randomUUID();
    const teaser = await storeValuation(token, address, result);

    // Backfill the estimate onto the matching UNNAMED partial lead (address-only,
    // no contact yet) so "Unnamed lead" rows carry a price in the admin even when
    // the visitor never completes the form. The frontend creates the partial lead
    // (POST /api/leads/partial) before calling this, so it already exists. We only
    // copy the numbers — we deliberately do NOT set valuations.leadId, which would
    // open the pre-contact reveal gate. Best-effort; never fail the response.
    try {
      const normalized = normalizeAddress(address).full || null;
      if (normalized) {
        await db
          .update(leads)
          .set({
            estimatedValue: result.estimatedValue,
            priceRangeLow: result.priceRangeLow,
            priceRangeHigh: result.priceRangeHigh,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(leads.normalizedAddress, normalized),
              isNull(leads.email), // unnamed partials only — never touch a real lead
              eq(leads.isDeleted, false),
            ),
          );
      }
    } catch (err) {
      console.error('[api/valuation] unnamed-lead price backfill failed:', err);
    }

    return NextResponse.json(teaser);
  } catch (err) {
    console.error('[api/valuation] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
