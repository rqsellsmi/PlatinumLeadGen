# Session Summary — IDX Feed Integration (Realcomp RAPI v2.4)

Branch: `claude/idx-feed-integration-plan-wqpm0b`. Migration added: **0015**.
Full detail in `docs/idx-build-summary.md`. This section supersedes the prior
one below for what's current.

## What was done

Integrated the Realcomp II IDX (RESO Web API / OData) feed end-to-end:

- **Pipeline** — `realcomp_tokens` (Neon-persisted OAuth token), `idx_listings`
  (~60 cols + `isOfficeListing`), `idx_listing_photos` (full Media set),
  `idx_sync_log`. `lib/realcomp.ts` (token + paginating OData fetch),
  `lib/idxSync.ts` (dual-query incremental sync, defensive mapping, no stale
  deactivation, chunked upsert). Hourly via **GitHub Actions** (`idx-sync.yml`,
  since Vercel Hobby caps crons at daily) + manual backfill workflow +
  `scripts/idx-initial-sync.ts` / `idx-verify-metadata.ts`.
- **Compliance** — `lib/idxDisclosures.ts` + `components/idx/*` (Realcomp logo,
  office credit, all disclaimers). Public queries in `lib/idx.ts` enforce the
  rules: Active/Pending/Closed only, entire-listing + address display gates,
  full photo gallery for Active only (§18.10).
- **Consumer** — the enhanced `/thank-you` **Full Valuation page**: restyled
  hero (estimate + confidence prominent, range beneath), then Similar Homes For
  Sale, Similar Homes Recently Sold, Market Report. Durable per-lead
  `reportToken` (`lib/reportAccess.ts`) powers the confirmation-email link + the
  admin view log. Both valuation forms redirect here (fixed a stale `city`
  form that read a non-existent `estimatedValue`).
- **Admin** — `/admin/idx-sync` (status + Run Now), `/admin/idx-listings`,
  `/admin/market-reports`; new IDX nav group.
- **Metrics (scope B)** — brokerage metrics + recent-sales tiles repointed to
  `idx_listings` office-closed deals (`lib/idxMetrics.ts`), **fallback-safe** (a
  no-op until the office sold-backfill runs, so nothing changes pre-data). CSV
  Data Upload + Recent Sales deprecated.

## Live-integration fixes (found during the owner's first connection)

The spec's identifiers were wrong for this account; corrected against the live
API + Realcomp support:
- **Token audience** `rapi.realcomp.com` → **`rcapi.realcomp.com`** (a wrong-but-
  present audience passed field validation, then 500'd during token issuance).
- **Data host** `idxapi.realcomp.com` (spec's `fullapi` served `$metadata` but
  404'd on data). Both now env-overridable (`REALCOMP_AUDIENCE`/`_BASE_URL`).
- **Office keys** are **`*OfficeMlsId`** (Edm.String, quoted), not `*OfficeKey`/
  `*OfficeKeyNumeric` — `REALCOMP_OFFICE_KEYS` hold OfficeMlsId values.
- **City** comes from **`OriginalPostalCity`** ("Sturgis"); `City`/`PostalCity`/
  `CountyOrParish` are county-suffixed enums ("SturgisCity_StJoseph"). County
  humanized ("StJoseph" → "St Joseph").
- **IIS query-length 404** on the office query → split the 4-field office filter
  into one request per field (union via upsert).

## What still needs to be done

- Run the initial backfills (sold year-by-year + the full `active` pull).
- Set `REALCOMP_*` (incl. `REALCOMP_AUDIENCE`, `REALCOMP_BASE_URL=idxapi`) in
  **Vercel** + **GitHub Actions secrets**; add the approved Realcomp logo at
  `public/assets/realcomp-logo.png`; apply migration `0015` on every Neon branch.
- Reconcile `REALCOMP_OFFICE_KEYS` to only RE/MAX Platinum offices (the feed's
  Office collection lists several unrelated "Platinum" brokerages — KW, RC).

## Lessons
See `docs/lessons-learned.md` §12 (spec-identifier drift, IIS URL limits, the
`$`-in-bcrypt-hash env-escaping trap, enum-normalized location fields, and
proving a token failure is upstream).

---

# Session Summary — Per-Office Reviews, Routing Rework & Scoring v2

Branch: `claude/previous-session-items-q3l47m`. Migrations added this session:
**0009–0014**.

## What was done

### Google reviews → per-office
- **Place IDs are per office**, not one global id (each office has its own Google
  Business Profile). Moved `googlePlaceId` + cached rating/count/fetchedAt onto
  `offices`; "Fetch now" iterates every office with a Place ID and caches its
  reviews (`google_reviews`, keyed by `place_id`) + rating/count back on the row.
- **Fetch errors are surfaced** (`offices.googleReviewsError`): the code swallowed
  non-OK Google responses and prod redacts thrown errors, so failures looked like
  "no reviews." Now the office card shows the real reason (e.g. `REQUEST_DENIED:
  API keys with referer restrictions cannot be used with this API`).
- **City pages show reviews**: each location can link to an office
  (`locations.officeId`); the city page renders that office's Google reviews and
  drives its hero/social-proof rating from the office's live numbers (else the
  manual per-location fields; unlinked → pooled across all offices).

### Round-robin rework
- **Interleaved slots** (`buildRotationList`): each agent's slots are spread by
  fractional position instead of clustered, so a newly-activated agent weaves in
  rather than landing at the end.
- **Move-to-back queue** (`recommendAgents`): front = next; the served slot moves
  to the back; slots **skipped for distance stay at the front** (a distance skip
  never costs an agent their turn). Order is intentionally not stable across
  leads. `pointer` is now vestigial (always 0).
- **Reconciled in place, never rebuilt** (`reconcileRotation`): roster/score
  changes preserve the live order + move-to-back progress (new agents weave in,
  removed/decreased slots drop out). Only the admin "Rebuild" button rebuilds.
- **Per-agent proximity**: agents pick their anchor — **office** or a **custom
  city** (entered by name, geocoded to lat/lng) — and their own **radius**
  (`/agent/settings`, mirrored in the admin agent editor). Routing pools an agent
  when the lead is within *that agent's* radius of *their* anchor.
- **No capacity cap** — owner decision, permanent.

### Scoring v2 (spec v2)
- **Four tracks** per agent (`scoreLifetime/Ytd/Monthly/Rolling365`), written
  together by `applyScore`, **uncapped** (no [0,200] clamp). `score` kept as a
  lifetime mirror.
- **New deltas**: fast +8 / +6 / +4 / +1, decline −3, no-response −4, closing
  **+25**, stale −2/−2, **stalled −3**.
- **Uncapped slots** from the rolling track: `1 + floor(sqrt(max(score,0)/10))`.
  Rolling window is **365 days** (log-derived sum, decays; a per-agent bootstrap
  log row seeds it at cutover).
- **Lifecycle**: **Lost** needs a prior Contacted + a fixed reason (no score);
  **30-day stall** (`pipeline_stalled`, recurring) on Qualified idle leads;
  **reopen** flips a Lost lead whose contact resubmits to a distinct `reopened`
  status, resets clocks, routes to the same active agent else fresh.
- **Percentile tiers**: Top Performer = top 10% of active agents by lifetime,
  down to At Risk (bottom 10%); tie-tolerant midrank so a fully-tied cohort lands
  mid-pack. `lib/scoreTiers.ts` (pure) + `lib/scoreTiersServer.ts` (cohort loader).
- **Leaderboards** (`/agent/leaderboard`): public monthly + YTD, top 20 + your
  rank; lifetime stays private on Performance.
- **Maintenance cron** (`/api/cron/score-maintenance`, daily): decays rolling-365
  and resets monthly (1st) / YTD (Jan 1), guarded so each fires once.
- **Lost-reason admin roll-up** (`/admin/lost-reasons`): reason mix + a per-agent
  table ranked by "unresponsive" share (flags ≥40% with 3+ Lost).

## What still needs to be done

**Operational (must do before it works):**
- **Apply migrations 0006–0014 in order on every Neon branch** (main, preview,
  and any Vercel auto-created per-preview branch). A skipped middle migration
  (e.g. 0012 proximity cols) breaks admin pages that `select` whole rows.
- **Create a dedicated Google server key** (`GOOGLE_MAPS_API_KEY`): unrestricted
  by referrer, with legacy **Places API + Geocoding API** enabled; redeploy.
- Confirm the preview deployment actually uses the shared `preview` DB
  (`APP_DATABASE_URL` set for the Preview env → **redeploy** to take effect).
- Configure: per-office Place IDs, link locations → offices, set homepage review
  source to Google/Both, then Fetch. `TWILIO_*`, `BLOB_READ_WRITE_TOKEN` as before.

**Open threads / not built:** daily Google-reviews auto-refresh cron; a tier above
"Top Performer"; consolidating the two "market trends" sources when the IDX feed
arrives (`docs/idx-integration.md`).

## Lessons
See `docs/lessons-learned.md` §11 (server API keys vs referrer restrictions,
migration hygiene across Neon branches, "only-some-pages-error" heuristic,
percentile-tier midrank, rolling-window bootstrap).
