/**
 * Initial IDX backfill (IDX spec §2.8). Runs via GitHub Actions (workflow_dispatch)
 * because the full pull takes 20-60 min — far past Vercel's serverless timeout.
 *
 * Usage:
 *   tsx scripts/idx-initial-sync.ts --query active
 *   tsx scripts/idx-initial-sync.ts --query sold --start 2024-01-01 --end 2025-01-01
 *
 * --query active : all Active/Pending/Closed feed-wide, 12-month window, no
 *                  office/location filter. Start/end ignored.
 * --query sold   : your offices' Closed sales within [--start, --end).
 *
 * Streams page-by-page (upserting each page) so memory stays flat and progress
 * prints roughly every 500 records. Exits non-zero on error (GitHub Actions
 * shows a red X).
 */
import './loadEnv';
import { realcompFetchPages, isRealcompConfigured } from '../lib/realcomp';
import { activeBackfillParams, soldBackfillParams, upsertRawListings } from '../lib/idxSync';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured — set REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET.');
  }

  const query = (arg('query') ?? '').toLowerCase();
  if (query !== 'active' && query !== 'sold') {
    throw new Error("--query must be 'active' or 'sold'.");
  }

  let params: Record<string, string>;
  if (query === 'active') {
    params = activeBackfillParams();
    console.log('[idx-initial-sync] active: all Active/Pending/Closed, last 12 months, feed-wide.');
  } else {
    const start = arg('start');
    const end = arg('end');
    if (!start || !end) throw new Error('--query sold requires --start and --end (YYYY-MM-DD).');
    params = soldBackfillParams(start, end);
    console.log(`[idx-initial-sync] sold: your offices, Closed, ${start} .. ${end}.`);
  }

  let fetched = 0;
  let upserted = 0;
  let lastReport = 0;

  const total = await realcompFetchPages('Property', params, async (page) => {
    fetched += page.length;
    upserted += await upsertRawListings(page);
    if (fetched - lastReport >= 500) {
      lastReport = fetched;
      console.log(`[idx-initial-sync] ${fetched} fetched, ${upserted} upserted…`);
    }
  });

  console.log(`[idx-initial-sync] DONE — ${total} fetched, ${upserted} upserted.`);
}

main().catch((err) => {
  console.error('[idx-initial-sync] FAILED:', err);
  process.exit(1);
});
