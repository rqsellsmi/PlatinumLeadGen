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
import { runIdxSync, probeIncrementalFirstQuery } from '../lib/idxSync';

async function main() {
  // stderr (unbuffered) so this survives a process kill.
  console.error(`[idx-sync] booting ${new Date().toISOString()}`);
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured — set REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET.');
  }

  // DIAGNOSTIC BUILD: preflight (token + $top=1 probes) then fire the sync's EXACT
  // first-window query with a 60s timeout, and EXIT — so if the real query hangs
  // we see it bounded and the log is readable, instead of a 10-min silent stall.
  await realcompPreflight();
  await probeIncrementalFirstQuery();
  console.error('[idx-sync] probes complete — exiting (diagnostic build).');
  return;
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
