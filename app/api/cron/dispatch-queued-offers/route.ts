/**
 * Cron: dispatch queued offers that are now inside the offer window. (Section 8)
 * Runs every 5 minutes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { findQueuedOfferIds, dispatchOfferEmail } from '@/lib/autoOffer';
import { isWithinOfferWindow } from '@/lib/offerWindow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const now = new Date();
    if (!isWithinOfferWindow(now)) {
      return NextResponse.json({ dispatched: 0 });
    }

    const ids = await findQueuedOfferIds();
    let dispatched = 0;
    for (const id of ids) {
      try {
        const sent = await dispatchOfferEmail(id);
        if (sent) dispatched += 1;
      } catch (err) {
        console.error(`[cron/dispatch-queued-offers] offer ${id} failed:`, err);
      }
    }

    return NextResponse.json({ dispatched });
  } catch (err) {
    console.error('[cron/dispatch-queued-offers] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
