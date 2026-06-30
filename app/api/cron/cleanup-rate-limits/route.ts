/**
 * Cron: purge rate_limits rows older than 24h (Section 8.4). Daily 5am UTC.
 */
import { NextRequest, NextResponse } from 'next/server';
import { lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rateLimits } from '@/drizzle/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await db.delete(rateLimits).where(lt(rateLimits.windowStart, cutoff));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[cron/cleanup-rate-limits] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
