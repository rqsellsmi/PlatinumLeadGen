/**
 * POST /api/buyer/valuation — a signed-in buyer's own-home valuation. Unlike the
 * public seller flow, an authenticated known contact sees the FULL estimate (no
 * reveal gate). Requesting a valuation is a lead-creating action (potential
 * seller signal): it runs onFirstEngagement with the home as the routing anchor,
 * asking the representation question first when needed. Same-origin guarded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuyerUserId } from '@/lib/buyerSession';
import { getValuation } from '@/lib/valuation';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { needsRepresentationAnswer, onFirstEngagement, parseRepresentation } from '@/lib/buyerEngagement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await checkPreset(clientIp(req.headers), 'valuation'))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  if (!address) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const lat = typeof body?.lat === 'number' ? body.lat : null;
  const lng = typeof body?.lng === 'number' ? body.lng : null;

  let estimate: {
    estimatedValue: number | null;
    priceRangeLow: number | null;
    priceRangeHigh: number | null;
  } | null = null;
  try {
    const result = await getValuation(address);
    if (result?.estimatedValue != null) {
      estimate = {
        estimatedValue: result.estimatedValue,
        priceRangeLow: result.priceRangeLow ?? null,
        priceRangeHigh: result.priceRangeHigh ?? null,
      };
    }
  } catch (err) {
    console.error('[api/buyer/valuation] valuation failed:', err);
  }

  // Ask representation once before creating the first lead; the estimate still
  // returns so the buyer sees their value immediately.
  const representation = parseRepresentation(body?.representation);
  if (!representation && (await needsRepresentationAnswer(buyerId))) {
    return NextResponse.json({ ok: true, estimate, needsRepresentation: true });
  }
  try {
    await onFirstEngagement({
      buyerUserId: buyerId,
      kind: 'valuation',
      home: { address, lat, lng },
      representation,
    });
  } catch (err) {
    console.error('[api/buyer/valuation] engagement failed:', err);
  }

  return NextResponse.json({ ok: true, estimate });
}
