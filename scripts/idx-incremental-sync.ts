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
import { runIdxSync, probeMediaDiagnostics } from '../lib/idxSync';

// Realcomp's feed-wide query stalls in ~20-minute stretches, then recovers (a
// reliability probe measured 8/8 fast, but 12 min later the same query hung 4x).
// The initial backfill survives this by being PATIENT — a long per-request
// timeout + hours of runtime — so it waits a bad stretch out and lands once
// Realcomp recovers. Match that here: a moderate timeout that logs progress each
// cycle, and enough retries to span a ~20-min outage. Each cycle ≈ timeout +
// backoff(≤30s); 20 retries ≈ 30 min of waiting before giving up. Once a request
// succeeds the sync blasts through the remaining hourly windows in seconds, and
// every completed window is checkpointed so an unfinished run resumes next time.
// With the phantom-nextLink hang fixed, empty windows return fast and real pages
// don't stall, so modest values suffice: a generous per-request timeout for a
// real media-expanded page, and a few retries for the occasional network blip.
const SYNC_REQUEST_TIMEOUT_MS = 90_000;
const SYNC_MAX_NET_RETRIES = 5;

/** Read a `--name value` CLI flag. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Parse an optional `--since YYYY-MM-DD` into an ISO timestamp (UTC midnight). */
function parseSince(): string | undefined {
  const raw = arg('since');
  if (!raw) return undefined;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`--since must be YYYY-MM-DD, got: ${raw}`);
  return d.toISOString();
}

async function main() {
  // stderr (unbuffered) so this survives a process kill.
  console.error(`[idx-sync] booting ${new Date().toISOString()}`);
  if (!isRealcompConfigured()) {
    throw new Error('Realcomp is not configured — set REALCOMP_CLIENT_ID / REALCOMP_CLIENT_SECRET.');
  }

  const sinceIso = parseSince();
  if (sinceIso) console.error(`[idx-sync] one-time back-pull from ${sinceIso}`);

  // Preflight health check (token + a no-media/with-media probe); never throws.
  await realcompPreflight();

  // DIAGNOSTIC BUILD: isolate which element (media / full select / narrow window)
  // zeroes the windowed query, then exit.
  await probeMediaDiagnostics();
  console.error('[idx-sync] media/window diagnostics complete — exiting.');
  process.exit(0);
  // eslint-disable-next-line no-unreachable

  let pages = 0;
  let fetched = 0;
  const started = Date.now();

  const result = await runIdxSync(
    // Wrap the paged fetch: patient timeout + many retries (wait out a Realcomp
    // stall) + progress logging so the Actions log shows liveness.
    (path, params, onPage) =>
      realcompFetchPages(
        path,
        params,
        async (page) => {
          pages += 1;
          fetched += page.length;
          await onPage(page);
          console.log(`[idx-sync] page ${pages}: +${page.length} (${fetched} fetched, ${Math.round((Date.now() - started) / 1000)}s)`);
        },
        // pageSize → client-driven $top/$skip paging (Realcomp's server-driven
        // nextLink returns empty pages + a phantom link for these filtered queries).
        { timeoutMs: SYNC_REQUEST_TIMEOUT_MS, maxNetRetries: SYNC_MAX_NET_RETRIES, pageSize: 1000 },
      ),
    { budgetMs: Infinity, sinceIso }, // runner has hours — drain the whole delta, never truncate
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
