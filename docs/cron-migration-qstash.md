# Moving the frequent crons off GitHub Actions → QStash

Status: **runbook, not yet executed.** Nothing in the app changes. `cron.yml`
stays in the repo until the QStash schedules are confirmed working.

## Why

`.github/workflows/cron.yml` is scheduled `*/10 * * * *` (144 runs/day expected).
Measured over Aug 3–6 2026 it actually ran **~13 times/day**, with gaps of 52–198
minutes. `idx-sync.yml` (`17 * * * *`, 24/day expected) ran ~7/day with gaps up
to 263 minutes, and never once started at `:17`. On top of that, two runs on
Aug 6 were **cancelled with no runner ever assigned** (`runner_id: 0`) after
sitting queued ~15 minutes.

GitHub's scheduler is servicing this repo's cron queue roughly every 2–3 hours.
Each cron *expression* fires about once per sweep — which is why the four daily
entries in `scheduled-daily.yml` all still fire (just 2–3h late) while a `*/10`
loses ~91% of its ticks. This repo is public, so it is on the free shared-runner
pool: the most congested one, and the one GitHub throttles hardest.

The business impact is concentrated in **one** job. `expire-offers` enforces the
3-hour acceptance window by sweep, so a 2–3h scheduler gap means an offer can sit
un-expired for 5–6h before `reassignLead()` runs — a lead parked on a
non-responding agent. Everything else (48h/weekly clocks, Google Ads
reconciliation, the daily jobs) tolerates hours of slop fine.

## Why QStash specifically

- **No app code changes.** QStash forwards `Upstash-Forward-*` headers with the
  prefix stripped, so the routes still receive `x-cron-secret` exactly as they do
  from `curl` today. (Vercel Cron, by contrast, sends `Authorization: Bearer` and
  would require editing all eight `/api/cron/*` routes.)
- **Free at this volume.** The schedules below total ~240 messages/day against a
  free tier that has historically been 500/day. Confirm current pricing at signup.
- **Retries + dead-letter queue**, unlike a plain HTTP pinger.
- Installable from the Vercel Marketplace, so billing and credentials are
  provisioned through the existing Vercel project.

`idx-sync.yml` **stays on GitHub Actions** — it runs `npm run idx:sync:incremental`
directly on the runner for up to 120 minutes, which no HTTP scheduler can do, and
2–3h IDX staleness is acceptable. `scheduled-daily.yml` also stays: all four of
its jobs do fire, just late, and late is fine for cleanup and digest work.

## Step 1 — rotate `CRON_SECRET`

`CRON_SECRET` is marked Sensitive in Vercel and write-only in GitHub, so the
current value cannot be read back from either. It does not need to be: generate a
new one and set it in every place at once.

Generate (PowerShell, works in 5.1 and 7):

```powershell
$bytes = New-Object byte[] 32
([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Do NOT use `Get-Random` — it is not cryptographically secure. Hex avoids the
`+ / =` characters Base64 would introduce into header values.

Then, **in this order** (2 and 3 before 4, so `cron.yml` does not 401 in the gap):

1. Copy the generated value somewhere temporary.
2. GitHub → Settings → Secrets and variables → Actions → update `CRON_SECRET`.
3. Vercel → Project → Settings → Environment Variables → update `CRON_SECRET`
   (Production).
4. **Redeploy.** Vercel env var changes do not apply to existing deployments
   until a new deploy.
5. Verify: Actions tab → "Scheduled jobs" → Run workflow. A green run means both
   sides agree on the new secret. Do not proceed until this passes.

## Step 2 — install QStash

Vercel → Integrations → Marketplace → Upstash. Installing links the account and
injects the QStash credentials into the project. Schedules themselves are created
in the Upstash console (reachable via a click-through from Vercel), not in Vercel.

## Step 3 — create the four schedules

| Endpoint | Cron | Msgs/day | Why this interval |
| --- | --- | --- | --- |
| `expire-offers` | `*/15 * * * *` | 96 | The one that matters — caps reassignment lag at 15 min |
| `dispatch-queued-offers` | `*/15 * * * *` | 96 | 7am ET window opens on time |
| `followup-check` | `0 * * * *` | 24 | 48h/weekly clocks; hourly is generous |
| `google-ads-dispatch` | `0 * * * *` | 24 | Daily reconciliation re-drives failures anyway |

Total ~240/day. Note this is *less* total traffic than the current `*/10` on
everything, which also keeps Neon from being held awake unnecessarily (see the
Neon note below).

For each schedule, whether via console or API:

- **Destination**: `https://<your-vercel-domain>/api/cron/<endpoint>`
- **Method**: `GET` — the routes only export a `GET` handler; QStash defaults to
  POST, which would 405.
- **Header**: `Upstash-Forward-x-cron-secret` → the new `CRON_SECRET`

Via the API, one schedule per call (sanity-check the header names against current
QStash docs before running):

```bash
curl -X POST "https://qstash.upstash.io/v2/schedules/https://<your-domain>/api/cron/expire-offers" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: */15 * * * *" \
  -H "Upstash-Method: GET" \
  -H "Upstash-Forward-x-cron-secret: $CRON_SECRET"
```

## Step 4 — verify, then disable the GitHub workflow

Watch the QStash message log for a few cycles. Expect `200`. A `401` means the
forwarded header is wrong; a `405` means the method is still POST.

Once green, disable the GitHub workflow: **Actions tab → "Scheduled jobs" → ⋯ →
Disable workflow.** This is a UI toggle, not a commit, which is why `cron.yml`
stays in the repo.

**Do not skip this.** `app/api/cron/expire-offers/route.ts` has no concurrency
guard: it selects offers with `status = 'offered'`, then writes each with
`.where(eq(leadOffers.id, offer.id))` and no status check on the update. If two
schedulers fire within the same few seconds, both can read the same offer before
either writes, producing a double `applyScore()` penalty and a double
`reassignLead()`. The odds are low but the window is real — run both only long
enough to confirm QStash works.

## Neon side effect

Neon compute currently bills ~3.9 CU-hours/day (~$8/mo of the ~$9 Neon invoice),
which at a 0.25 CU floor implies the database is auto-suspending several hours a
night. A scheduler that actually fires around the clock keeps it awake more. The
intervals above are chosen partly to limit this: only the two jobs that need
frequency get it. Worth watching the next Neon invoice, and checking Neon's
autosuspend window so the two are tuned together rather than fighting.

## Not covered here

- **`idx-sync.yml` / `idx-initial-sync.yml`** — stay on GitHub Actions; they need
  a long-running host, not an HTTP ping.
- **`ci.yml`** — the same runner shortage will flake it, but push/PR-triggered
  runs are not throttled the way schedules are. Separate problem.
- **A dead-man's-switch** — QStash failure notifications cover this for the four
  jobs above. `idx-sync` remains unmonitored.
