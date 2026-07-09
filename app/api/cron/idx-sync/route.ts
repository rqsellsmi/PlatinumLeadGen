/**
 * Cron: hourly IDX sync (IDX spec §2.6). Runs the incremental dual-query sync
 * and logs record counts to idx_sync_log. Guarded by CRON_SECRET.
 *
 * The initial full backfill CANNOT run here (Vercel's 60s timeout) — use the
 * GitHub Actions workflow (scripts/idx-initial-sync.ts) for that.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runIdxSync } from '@/lib/idxSync';
import { realcompFetch, isRealcompConfigured } from '@/lib/realcomp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isRealcompConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'Realcomp not configured' });
  }

  try {
    const result = await runIdxSync((path, params) => realcompFetch(path, params));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[cron/idx-sync] failed:', err);
    return NextResponse.json(
      { error: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
