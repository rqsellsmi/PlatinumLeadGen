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
 * RESUMABLE: each job orders by ModificationTimestamp ascending and checkpoints
 * the newest timestamp processed (idx_backfill_checkpoints). If the run fails
 * partway, the NEXT run resumes from that checkpoint instead of re-fetching
 * everything — so a retry is fast. A successful job clears its own checkpoint;
 * pass --restart to force a full pull. Streams page-by-page (upserting each
 * page) so memory stays flat; the fetch layer retries transient network/5xx
 * errors and re-mints the token on 401.
 */
import './loadEnv';
import { realcompFetchPages, isRealcompConfigured } from '../lib/realcomp';
import {
  activeBackfillJob,
  soldBackfillJobs,
  upsertRawListings,
  pageMaxModTimestamp,
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
    jobs = [activeBackfillJob()];
    console.log('[idx-initial-sync] active: all Active/Pending/Closed, last 12 months, feed-wide.');
  } else {
    const start = arg('start');
    const end = arg('end');
    if (!start || !end) throw new Error('--query sold requires --start and --end (YYYY-MM-DD).');
    jobs = soldBackfillJobs(start, end);
    console.log(`[idx-initial-sync] sold: your offices, Closed, ${start} .. ${end} (${jobs.length} passes).`);
  }

  let fetched = 0;
  let upserted = 0;
  let lastReport = 0;

  for (const job of jobs) {
    if (restart) await clearBackfillCheckpoint(job.key);
    const since = restart ? null : await getBackfillCheckpoint(job.key);
    if (since) console.log(`[idx-initial-sync] resuming ${job.key} from ${since}`);

    await realcompFetchPages('Property', job.buildParams(since), async (page) => {
      fetched += page.length;
      upserted += await upsertRawListings(page);
      // Checkpoint AFTER the page is upserted, so a crash never advances the
      // resume point past unsaved data.
      const maxTs = pageMaxModTimestamp(page);
      if (maxTs) await setBackfillCheckpoint(job.key, maxTs);
      if (fetched - lastReport >= 500) {
        lastReport = fetched;
        console.log(`[idx-initial-sync] ${fetched} fetched, ${upserted} upserted…`);
      }
    });

    // Job finished cleanly — clear its checkpoint so a later run is a full pull.
    await clearBackfillCheckpoint(job.key);
    console.log(`[idx-initial-sync] ${job.key} complete.`);
  }

  console.log(`[idx-initial-sync] DONE — ${fetched} fetched, ${upserted} upserted.`);
}

main().catch((err) => {
  console.error('[idx-initial-sync] FAILED:', err);
  process.exit(1);
});
