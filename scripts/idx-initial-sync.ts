/**
 * Initial IDX backfill (IDX spec §2.8). Runs via GitHub Actions (workflow_dispatch)
 * because the full pull takes 20-60+ min — far past Vercel's serverless timeout.
 *
 * Usage:
 *   tsx scripts/idx-initial-sync.ts --query active
 *   tsx scripts/idx-initial-sync.ts --query sold --start 2024-01-01 --end 2025-01-01
 *   tsx scripts/idx-initial-sync.ts --query active --restart   (ignore any checkpoint)
 *
 * --query active : all Active/Pending/Closed feed-wide, 12-month window.
 * --query sold   : your offices' Closed sales within [--start, --end).
 *
 * RESUMABLE: the feed-wide pull is split into bounded MONTH windows (no
 * server-side $orderby, which times out on a large RESO result set). Each
 * window/pass records completion in idx_backfill_checkpoints, so a failed run
 * re-runs only the windows not yet done. Pass --restart to force a full re-run.
 * Streams page-by-page (upserting each page) so memory stays flat; the fetch
 * layer retries transient network/5xx errors and re-mints the token on 401.
 */
import './loadEnv';
import { realcompFetchPages, isRealcompConfigured } from '../lib/realcomp';
import {
  activeBackfillJobs,
  soldBackfillJobs,
  upsertRawListings,
  getBackfillCheckpoint,
  setBackfillCheckpoint,
  clearBackfillCheckpoint,
  type BackfillJob,
} from '../lib/idxSync';

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
  const restart = process.argv.includes('--restart');

  let jobs: BackfillJob[];
  if (query === 'active') {
    jobs = activeBackfillJobs();
    console.log('[idx-initial-sync] active: feed-wide primary-photo pass + Active/UC gallery pass.');
  } else {
    const start = arg('start');
    const end = arg('end');
    if (!start || !end) throw new Error('--query sold requires --start and --end (YYYY-MM-DD).');
    jobs = soldBackfillJobs(start, end);
    console.log(`[idx-initial-sync] sold: your offices, Closed, ${start} .. ${end} (${jobs.length} passes).`);
  }

  // --restart forces a full re-run by clearing every job's done-marker first.
  if (restart) {
    for (const job of jobs) await clearBackfillCheckpoint(job.key);
  }

  let fetched = 0;
  let upserted = 0;
  let lastReport = 0;

  for (const job of jobs) {
    // Resume: a job with a done-marker is already complete — skip it.
    if (await getBackfillCheckpoint(job.key)) {
      console.log(`[idx-initial-sync] ${job.key} already done — skipping.`);
      continue;
    }
    console.log(`[idx-initial-sync] ${job.key}…`);

    await realcompFetchPages('Property', job.params, async (page) => {
      fetched += page.length;
      upserted += await upsertRawListings(page, { galleries: job.galleries });
      if (fetched - lastReport >= 500) {
        lastReport = fetched;
        console.log(`[idx-initial-sync] ${fetched} fetched, ${upserted} upserted…`);
      }
    });

    // Whole window/pass done — mark it so a re-run skips it.
    await setBackfillCheckpoint(job.key, new Date().toISOString());
    console.log(`[idx-initial-sync] ${job.key} complete.`);
  }

  console.log(`[idx-initial-sync] DONE — ${fetched} fetched, ${upserted} upserted.`);
}

main().catch((err) => {
  console.error('[idx-initial-sync] FAILED:', err);
  process.exit(1);
});
