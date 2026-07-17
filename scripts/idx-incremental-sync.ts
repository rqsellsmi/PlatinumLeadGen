/**
 * Incremental IDX sync (IDX spec §2.6) — the HOURLY job.
 *
 * Runs the same runIdxSync() as the /api/cron/idx-sync endpoint, but ON THE
 * GITHUB RUNNER (via .github/workflows/idx-sync.yml) instead of pinging Vercel.
 * The Vercel function is hard-capped at 60s, and a feed-wide delta with full
 * Media expand does not fit in 60s — the function was killed mid-run every time,
 * saving nothing and never advancing the cursor (a permanent 504 loop). The
 * runner has a multi-hour timeout, so we pass `budgetMs: Infinity` and drain the
 * whole delta in one run.
 *
 * Streams page-by-page (flat memory); the fetch layer retries transient
 * network/5xx errors and re-mints the token on 401. Needs DATABASE_URL +
 * REALCOMP_* in the environment (the workflow provides them as Actions secrets).
 *
 * Usage: tsx scripts/idx-incremental-sync.ts
 */
import './loadEnv';
import { realcompFetchPages, isRealcompConfigured, realcompPreflight } from '../lib/realcomp';
import { runIdxSync, probeFirstWindowUpsert } from '../lib/idxSync';

async function main() {
  // stderr (unbuffered) so this survives a process kill.
  console.error(`[idx-sync] booting ${new Date().toISOString()}`);
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured — set REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET.');
  }

  // DIAGNOSTIC BUILD: the bare query is proven fine, so exercise the first window's
  // fetch AND real upsert (the DB write path) with per-write logging, bounded by a
  // hard 90s timeout, then force-exit — so a hang in upsertRawListings /
  // setBackfillCheckpoint is pinned exactly and the step's log stays readable.
  await realcompPreflight();
  await Promise.race([
    probeFirstWindowUpsert(),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        console.error('[probe2] TIMED OUT after 90s — the last logged step is where it hangs.');
        resolve();
      }, 90_000),
    ),
  ]);
  console.error('[idx-sync] probes complete — exiting (diagnostic build).');
  process.exit(0);
  // eslint-disable-next-line no-unreachable

  let pages = 0;
  let fetched = 0;
  const started = Date.now();

  const result = await runIdxSync(
    // Wrap the paged fetch to print progress as it streams — so the Actions log
    // shows liveness on a large catch-up, the way idx-initial-sync does.
    (path, params, onPage) =>
      realcompFetchPages(path, params, async (page) => {
        pages += 1;
        fetched += page.length;
        await onPage(page);
        console.log(`[idx-sync] page ${pages}: +${page.length} (${fetched} fetched, ${Math.round((Date.now() - started) / 1000)}s)`);
      }),
    { budgetMs: Infinity }, // runner has hours — drain the whole delta, never truncate
  );

  console.log(
    `[idx-sync] DONE — Q1: ${result.query1Upserted}/${result.query1Fetched}, ` +
      `Q2: ${result.query2Upserted}/${result.query2Fetched} upserted` +
      `${result.truncated ? ' (truncated?!)' : ''}.`,
  );
}

main().catch((err) => {
  console.error('[idx-sync] FAILED:', err);
  process.exit(1);
});
