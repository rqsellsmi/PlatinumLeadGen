# Session Summary — Texting & Refinement (round 1: refinements)

Branch: `texting-and-refinement`. Migrations added: **0021–0022**. Full lessons
in `docs/lessons-learned.md` §14. (Texting itself is deferred to a later round —
this round is three refinements.)

## What was done

### 1. Exit-intent pop-up auto-populates like the other forms
The exit-intent overlay's address field now runs the **same Google Places
autocomplete** as the hero box and modal step-1 (it was a plain text input).
Attaches on open once Maps JS is ready (loaded by HeroValuation on the same
page; retries briefly), and hands off the resolved address **plus coordinates**
through `OPEN_VALUATION_EVENT` so the valuation runs with lat/lng.
(`components/cro/ExitIntentOverlay.tsx`, event consumer in `HeroValuation.tsx`.)

### 2. Wider hero address field on desktop
The hero "Enter your home address" box was clipping long addresses (form capped
at `max-w-xl` behind a wide button). Form is now `max-w-xl sm:max-w-2xl
lg:max-w-3xl`, the input basis widened (`basis-72`), and both hero content
wrappers raised to `lg:max-w-[760px]` so the wider form has room.
(`HeroValuation.tsx`, `app/page.tsx`, `components/city/HeroSection.tsx`.)

### 3. Sold-listing detail page redesigned to a "data sheet" + neighborhood map
`/listing/[listingKey]` rebuilt to match the owner's mockup:
- **Photo hero with overlay** (`components/idx/ListingHero.tsx`): status badge
  (green SOLD / red live), location eyebrow (subdivision · city), address, price
  + "sold X% over/under asking". Sold shows the "one photo per MLS" note.
- **Dark stat bar**: sold → Closed month, Days on market, List price, Sale-to-list;
  live → Status, DOM, List price, $/sq ft. Then a beds/baths/sqft/year row.
- **Feature chips** derived from the new structured fields (waterfront access,
  1st-floor primary, gas fireplace, main-floor laundry, finished lower level,
  pool, new construction, garage).
- **Two-column detail** — Interior & systems / Lot, water & costs — built from
  the expanded feed, empty values omitted. **School district kept** as a fact
  (owner's call); schools are excluded only from the POI section below.
- **Neighborhood highlights** (`components/idx/AreaHighlights.tsx`): an embedded
  Google map + nearby restaurants, coffee, groceries, gas, fitness, pharmacy,
  medical, parks, golf with nearest-name + distance + count. This is the
  ListReports-style "area report" the owner asked for, **minus schools**.
- **"How this home compared"** dark block (sold only): DOM / sale-to-list /
  $-per-sqft vs the city medians, with an "outperformed" headline, plus the full
  **Market Report** card (reused) and a seller CTA footer.
- IDX compliance unchanged (Realcomp logo, office credit, disclaimers).

### Data + infra for the above
- **Expanded IDX feed** (migration **0021**, `SELECT_FIELDS` + `mapRealcompListing`):
  ~35 buyer-relevant RESO fields — HOA fee/frequency/includes/amenities, taxes,
  heating, cooling, fireplaces, laundry, interior/exterior features, appliances,
  flooring, construction, roof, foundation, parking, pool, patio, lot features,
  water source, sewer, utilities, style, levels/stories, rooms, view, zoning,
  new-construction. Enum multi-values serialize via a new generic
  `serializeEnumList` (dedupes; `serializeWaterfrontFeatures` now delegates to
  it). All hide gracefully until the next sync/backfill populates them.
- **Neighborhood POI cache** (migration **0022** `area_poi_cache`,
  `lib/nearbyPlaces.ts`): server-side Google Places Nearby Search around the
  listing, **cached by a coarse ~110 m grid cell** so nearby listings reuse one
  lookup and repeat views cost $0; each POI stores its own coords so exact
  per-home distances recompute from any home in the cell. Reuses the `haversine`
  from `lib/routing`. Feature-flagged (`LISTING_AREA_POI=0` disables); degrades to
  map-only (or nothing) without a key. Logs each call to `api_usage_logs`.

## What still needs to be done (owner)
- **Apply migrations 0021–0022** on every Neon branch the app + GitHub Actions use.
- **Re-run the IDX backfill** (active + sold) so the new buyer fields populate —
  incremental sync also backfills them over time as listings are re-touched, but
  a backfill fills the existing rows immediately.
- **Google Places**: ensure the server key (`GOOGLE_MAPS_API_KEY`) has the
  **legacy Places API** enabled + billing on (Nearby Search is billed per call,
  ~$32/1k, bounded by the cache). Set `LISTING_AREA_POI=0` to turn the section
  off. The embedded map uses the public `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps
  Embed API — free per load) and needs the **Maps Embed API** enabled.
- **Verify live**: confirm the new RESO field names against `$metadata` (a few
  may differ on this account, per the IDX drift lessons) and that Nearby Search
  returns as expected. Both were built defensively (missing fields → NULL/hidden).

## Lessons
See `docs/lessons-learned.md` §14.

---

# Session Summary — Listing/Valuation Fixes + IDX Backfill Hardening

Branch: `claude/listing-valuation-fixes-1yqjax`. Migrations added: **0017–0020**
(0016 pre-existing). Full lessons in `docs/lessons-learned.md` §13.

## What was done

### Consumer-facing IDX + valuation
- **Listing detail pages** (`/listing/[listingKey]`, new): every displayed IDX
  listing (similar-homes cards + recent-sales tiles) links here. Full gallery for
  Active + ActiveUnderContract; primary photo only for Pending/Closed (§18.10).
  Office credit + Realcomp logo + copyright immediately after the property body
  (§18.3.4), all disclaimers, unbranded virtual-tour link. **NOINDEX** by default
  (`IDX_INDEX_LISTINGS=1` to flip). Cards/tiles made clickable; recent-sales
  `HomeRecentSale` carries `listingKey` (null for CSV closings, which have no
  detail page).
- **Recent-sales tiles** (home + city): confirmed listing-side office only
  (list/co-list `*OfficeMlsId` ∈ `REALCOMP_OFFICE_KEYS`); excluded closed leases.
- **Similar Homes ranking**: replaced price-band + nearest-coords with a
  multi-field similarity score (same-city + geo distance, beds, baths, sqft,
  property family, year, price); subject attributes threaded from the report
  `basics`. Leases excluded from Similar Homes For Sale, Recently Sold, and the
  market stats.
- **Explore Your Market** tiles: prefer a configured blob image
  (`lib/cityImages.ts`, slug→URL) then the most-recent office-sale photo.
- **Realcomp logo fix**: file was committed as `Realcomp Logo.png` while code
  referenced `/assets/realcomp-logo.png` (404) — renamed + fixed the 115×55
  aspect ratio (was forced square).
- **Market Report redesign** (brokerage card): median + YoY pill, stat rail
  (median $/sqft, avg DOM, list-to-sale, homes sold 90d, % above asking), a
  trailing-12-month median bar chart, source footer (`getCityMarketReport()`).
  Now on the valuation page AND every city page. Homepage below-hero metrics
  switched to the same four metrics as the city pages (`MarketStatsBar`
  refactored to shared normalized props, fed by `home_page_metrics`).
- **AI market narrative** (`lib/marketNarrative.ts`): 2–3 sentence human summary
  via the Anthropic API (Haiku 4.5; `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`),
  cached per city (regenerated only when the stats signature changes),
  deterministic fallback with no key. Output guaranteed **free of em/en dashes**
  (owner request; `stripDashes` + unit test).
- **Footer address** reflects the page's office: linked office
  (`locations.officeId`) → closest active office by coordinates → Brighton
  default (`getFooterOffice()`; `SiteFooter` is now async).

### Lead data + property records
- **Unnamed-lead pricing**: `/api/valuation` backfills the estimate onto the
  matching address-only partial lead (`email IS NULL`) so "Unnamed lead" rows
  carry a price. Does NOT set `valuations.leadId` (that would open the
  pre-contact reveal gate) — it only copies the numbers.
- **Full property record** on agent + admin lead pages and a new
  **`/admin/property-lookup`** tool. ATTOM `property/expandedprofile` (owner of
  record — public record in MI — tax/assessment, full building detail); RentCast
  `/properties` fallback. Cached by address (`property_records`, migration
  **0018**). `getPropertyRecord()` = provider dispatch + cache + usage logging.
  Display is agent-friendly: **no raw-JSON dump**, ATTOM's ALL-CAPS values
  title-cased at render.

### Ops: scheduled jobs + IDX backfill
- **Scheduled-jobs 404 fix**: `vercel.json` declared **6** crons but Hobby allows
  **2** (and Vercel Cron never sends the `x-cron-secret` these routes require), so
  production wasn't deploying and every `/api/cron/*` 404'd. Emptied `vercel.json`
  crons; moved the daily/weekly jobs (cleanup-rate-limits, score-maintenance,
  broker-digest) to a new `scheduled-daily.yml` GitHub Actions workflow; trimmed a
  trailing slash from `DEPLOY_URL` in every workflow. The live 404 itself was
  `DEPLOY_URL` pointing at the wrong host → set it to the pre-launch URL
  `https://platinum-lead-gen.vercel.app`.
- **IDX backfill saga** (each failure unmasked the next — lessons §13):
  varchar(100) overflow → migration **0016** applied + **0017** (widen URL
  columns) · OData enum literal `'Active Under Contract'` → **`ActiveUnderContract`**
  (enum member names have no spaces) · token expiry mid-run → re-mint on **every**
  401 (was a one-shot latch) · transient `UND_ERR_HEADERS_TIMEOUT` → per-request
  90s abort timeout + backoff retry on network/5xx · **resumable backfill**
  (migration **0020** `idx_backfill_checkpoints`; order by ModificationTimestamp
  asc, checkpoint per page, resume from it, `--restart` to force full) ·
  **two-pass photo fetch** (feed-wide primary-only `$expand=Media(...;$top=1)` +
  Active/UC-only full-gallery pass; ~10× less photo transfer) · job timeout
  120 → 350 min. Photo policy: galleries for Active + ActiveUnderContract only;
  primary-only for Pending/Closed; photos "follow" status across syncs.

## What still needs to be done
- Apply migrations **0017–0020** on every Neon branch the app + GitHub Actions
  use (and 0016 if any branch still lacks it).
- Cloud env: `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`); confirm the ATTOM
  plan includes `property/expandedprofile`; set `DEPLOY_URL` and `SITE_URL` to the
  live URL (update at the `www.remax-platinumonline.com` switchover);
  `IDX_INDEX_LISTINGS` only if listing pages should be indexed.
- Run the `active` backfill to completion (two-pass, resumable). Verify the
  `ActiveUnderContract` literal against the live feed (`standard_status`/
  `mls_status`) and that `$expand=Media(...;$top=1)` is accepted.
- Populate `lib/cityImages.ts` with real blob URLs; set office
  coordinates/addresses so the footer's closest-office logic resolves.

## Lessons
See `docs/lessons-learned.md` §13.

---

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

## GitHub Actions backfill saga (PRs #7–#10)

The build merged in PR #7; getting the manual "IDX Initial Sync" workflow to run
green took four follow-up fixes, each unmasking the next:
- **#8** — the workflow ran the app's full `validateEnv`, which requires NextAuth/
  admin vars the backfill doesn't need → set `SKIP_ENV_VALIDATION=1` in the job.
- **#9** — env getters used `??`, so **empty** (unset) GitHub secrets overrode the
  built-in defaults with `""` → switched auth/host/audience getters to `||`.
- **#10** — the sync still 401'd `Invalid Audience` after the config was correct:
  a **stale blank-audience token** cached in `realcomp_tokens` from an early run
  was being reused. Fix = self-heal: `getValidRealcompToken(forceRefresh)` +
  on-401 re-mint-and-retry in `realcompFetch`/`realcompFetchPages`, plus a one-time
  `DELETE FROM realcomp_tokens` to evict the poisoned row.

## What still needs to be done

- Run the initial backfills (sold year-by-year + the full `active` pull) — the
  auth path now self-heals, so a bad cached token can't wedge it again.
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
