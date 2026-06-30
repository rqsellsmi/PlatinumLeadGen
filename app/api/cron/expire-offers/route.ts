/**
 * Cron: expire offers whose 3-hour acceptance window has elapsed. (Section 8)
 * Runs every 10 minutes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers } from '@/drizzle/schema';
import { applyScore } from '@/lib/scoring';
import { reassignLead } from '@/lib/autoOffer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - THREE_HOURS_MS);

    const candidates = await db
      .select({ id: leadOffers.id, leadId: leadOffers.leadId, agentId: leadOffers.agentId })
      .from(leadOffers)
      .where(
        and(
          eq(leadOffers.status, 'offered'),
          isNotNull(leadOffers.offerSentAt),
          lt(leadOffers.offerSentAt, cutoff),
        ),
      );

    let expired = 0;
    for (const offer of candidates) {
      try {
        await db
          .update(leadOffers)
          .set({ status: 'expired', expiredAt: now, updatedAt: now })
          .where(eq(leadOffers.id, offer.id));

        await applyScore({
          agentId: offer.agentId,
          reason: 'system_no_response',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });

        await reassignLead(offer.leadId);
        expired += 1;
      } catch (err) {
        console.error(`[cron/expire-offers] offer ${offer.id} failed:`, err);
      }
    }

    return NextResponse.json({ expired });
  } catch (err) {
    console.error('[cron/expire-offers] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
