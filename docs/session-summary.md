# Session Summary — Agent Scoring v4 (Seller Track)

Branch: `refinements-v1`. Migrations added: **0027–0028**. Design +
decisions: `docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md`;
plan: `docs/superpowers/plans/2026-07-22-agent-scoring-v4.md`.

Rebuilt the agent point system around the new **Seller Track** status flow and
replaced the three stale-lead penalties with one unified update clock. Built in
8 phases (typecheck + tests green after each); final gate: typecheck clean,
build compiles, **155 tests across 17 files**.

## What shipped
- **Status flow:** `new`→`attempted_contact`→`connected`→`nurturing`→
  `appointment_set`→`signed`→`closed` (+ `lost`/`reopened`), with an enforced
  transition map (`ALLOWED_TRANSITIONS`) and manual reason-free backward moves
  to Nurturing. v2 statuses (`contacted`/`qualified`/`working`) retired but kept
  in the enum (Postgres can't drop values); data mapped in `0028`.
- **Points:** accept reduced to 4/3/2/1; new **fast-engagement** bonus 4/3/2/1
  (once, on first Attempted/Connected from accept); **once-only milestones**
  (Attempted +1, Connected +2, Nurturing 0, Appt +4, Signed +10, Closed +25)
  guarded by atomic `leads.milestone_*` claims; worked example = 50 (tested).
- **Unified update clock:** `update_deadline` (24h → 7d → 14d Signed → null at
  Closed/Lost); overdue → flat −2 `missed_update_checkin`, recurring; a
  pre-deadline warning email; escalation/weekly/digest kept.
- **Lost:** single status, origin-scoped reason lists (Lost A/A2/B/C/D), A2
  gated at 6 attempts, 0 points. SMS `LOST` redirects to the portal (reason is
  stage-gated).
- **Reopen (D2/D4):** `reopened` behaves like New, bumps `reactivation_count`
  (Lost→Reopened, reporting-only, shown as an admin badge), restarts the clock,
  preserves milestones (no re-pay).
- **Surfaces:** `lib/scoring.ts`, `lib/statusUpdates.ts` (the engine),
  `lib/offerActions.ts`, `followup-check` cron, `leads/submit` reopen,
  `lib/smsCommands.ts` (v4 vocabulary), agent StatusUpdateForm/PipelineBoard/
  dashboard, admin status pickers + filters, `scoreReasonLabel`/`statusTone`.

## What still needs to be done (owner)
- **Apply migrations 0027 + 0028** on every Neon branch the app + GitHub Actions
  use (several admin pages `select` whole lead rows, so the columns must exist).
- No env changes; routing slots + four-track aggregation unchanged.
- Buyer Track is a future, separate design (blue boxes are placeholders).

## Lessons
See `docs/lessons-learned.md` §19.

---

# Session Summary — Telnyx Agent Texting (Phase 1) + Queue Head Start & Portal Score

Branch: `claude/texting-telnyx-requirements-ktc9fo`. Migrations added:
**0024–0025**. Full lessons in `docs/lessons-learned.md` §17 (the Telnyx build)
and §18 (this update — post-review fixes + the queue head start).

## What was done

### 1. Telnyx agent texting (Phase 1) — two-way SMS with agents
Built two-way SMS between the platform and agents, replacing the long-dormant
Twilio stub. **Telnyx-only**; email remains the source of truth for every
notification — SMS is additive and no-ops safely (never throws) whenever it's
unconfigured, the agent has no phone, or they've opted out.
- **Schema** (migration `0024_telnyx_sms`): `offices.telnyx_number` (outbound
  "from" address), `agents.sms_opt_out`/`sms_opt_out_at`, and a new
  `sms_messages` audit table (mirrors `email_send_log` for the SMS channel).
- **Outbound** (`lib/agentSms.ts`), sent from the agent's home-office
  `offices.telnyx_number` (fallback `TELNYX_DEFAULT_FROM`): a reply-based
  **offer teaser** (no client PII) on a new offer, the **full client-info
  text** on accept/manual-assignment, and an **update-due reminder** at the 48h
  first-update-overdue point.
- **Inbound** (`POST /api/webhooks/telnyx`): Ed25519 signature verification,
  **fail-closed** (401 on any missing/bad signature, before the body is even
  parsed). Commands: `YES`/`NO <lead#>` (accept/decline), multi-word status
  phrases (`CONTACTED`/`SPOKE`/`LEFT VM`/`CALLED`/`ATTEMPTED`/`QUALIFIED`/
  `WORKING`/`CLOSED`/`LOST`), and `STOP`/`START`/`HELP` (opt-out). Delivery
  receipts update `sms_messages.status`. Unknown senders/commands are emailed
  to the owner. Agents are identified by matching their cell to `agents.phone`.
- **Shared cores** extracted so the web UI and SMS commands run identical
  logic: `lib/offerActions.ts` (accept/decline), `lib/statusUpdates.ts`
  (status updates), `lib/clientInfoSms.ts` (client-info send, kept separate to
  avoid a circular import with `offerActions.ts`). New pure, unit-tested libs:
  `smsCommands`, `telnyxSignature`, `smsTemplates`, `officeNumbers`, `agentSms`,
  `smsMessages`.
- Full detail in `docs/current-state.md` §4.7.

### 2. Post-review fix: agent-phone normalization (commit `64e42ce`)
A whole-branch review surfaced a seam a per-task review couldn't see: the
webhook matched inbound senders against `agents.phone` with an **exact**
E.164 comparison, but the admin agent form stored phones **un-normalized**
(e.g. `(810) 555-0134`) — so most agents' text replies silently fell through
as "unrecognized sender." Fixed by normalizing on write (agent create/update
Server Actions) **and** matching tolerantly (normalize-then-compare) in the
webhook, so both old and new rows work. Also in this pass: an agent-settings
**activation notice** ("activating enables text-message lead notifications"),
removal of the dead `telnyxConfigured()` export, and a stale "accept link"
code comment corrected to describe the reply-based teaser it actually sends.

### 3. Lead deep-link + privacy policy (commit `b247e19`)
The client-info and update-due-reminder texts now include a **deep link** to
`/agent/leads/<leadOfferId>`, threaded through the offer-accept, manual-
reassign, and 48h-escalation call sites, so an agent can jump straight to the
lead from the text. Added a carrier-required **SMS section to the privacy
policy** (opt-in/opt-out mechanics, message frequency, and a clause that
mobile numbers and SMS opt-in consent are never shared or sold to third
parties) — needed for 10DLC registration.

### 4. Queue head start: one-time +50 on first activation (commit `b7cf021`)
Agents previously entered the rotation at whatever their history happened to
score them, so a brand-new agent could sit behind everyone else in the queue
indefinitely. Migration `0025_agent_starting_credit` adds
`agents.starting_credit_granted_at` and a `starting_credit` score-reason
value. `lib/scoring.ts grantStartingCreditIfFirstActivation` grants a
one-time **+50 to `scoreRolling365` ONLY** (queue slots) the first time an
agent flips themselves Available (`POST /api/agent/availability`) — never
touching lifetime/monthly/YTD, so tiers and leaderboards are untouched.
Implemented as a direct `agent_score_log` insert + `recomputeRolling365`
(never through `applyScore`; `resolveScoreDelta` throws if `starting_credit`
is ever passed to it, as a structural guard). One-time-ness is enforced by an
atomic `UPDATE ... WHERE starting_credit_granted_at IS NULL RETURNING id`
claim. The credit decays out of the 365-day rolling window ~1 year after
*that agent's* activation (not system launch). Existing already-active agents
are not bulk-backfilled — they get it on their next activation toggle.

### 5. Portal score display reworked (commit `2299ab6`)
Agents previously saw one unlabeled lifetime score on a stale 0–200 bar, which
didn't explain their actual queue standing. `GET /api/agent/score` and
`components/agent/ScorePanel.tsx` now surface **all four score tracks** with
plain labels: **Queue Score** (rolling-365, the hero number) with a slots
readout and a "{X} more points to gain another slot in the queue" progress
meter, **Tier** (lifetime), **This Month** (monthly), **Year to Date** (ytd).
Removed the stale v1 `SCORE_MAX = 200` cap (v2 scoring has been uncapped since
Scoring v2, but the panel never caught up). Added a "New-agent head start"
label for the `starting_credit` reason in the score-history log.

## What still needs to be done (owner)
- **Telnyx (pre-launch, unchanged by this session's fixes):** provision the
  Telnyx number(s) and complete 10DLC/toll-free carrier registration; set
  `TELNYX_API_KEY`/`TELNYX_PUBLIC_KEY` in every environment that sends or
  processes texts; point the Telnyx portal's inbound webhook at
  `/api/webhooks/telnyx` and confirm its public key matches
  `TELNYX_PUBLIC_KEY`. One number (`TELNYX_DEFAULT_FROM`) covers launch;
  per-office numbers are a later step (each needs its own separate 10DLC
  campaign) for when Local Services Ads goes live per office. Live send/
  receive is still untested — no Telnyx credentials exist in the build
  sandbox.
- **Apply migrations 0024–0025** on every Neon branch the app + GitHub Actions use.
- Queue head start / portal score need no owner setup — both are pure
  application logic verified by unit tests, typecheck, and build (132 tests
  across 14 files).

## Lessons
See `docs/lessons-learned.md` §17 (the Telnyx build) and §18 (this session's
phone-normalization fix, the rolling-only credit design, and the four-tracks
display).

---

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

### 4. Hero images now load from the "Hero Images" Vercel Blob folder
`lib/heroImages.ts` gained `getHeroImages()` — lists the blob folder
`Hero Images/` (override with `HERO_IMAGES_BLOB_PREFIX`) at request time,
returns the public blob URLs (image extensions only, stable-sorted), cached
in-process 5 min. The homepage (`app/page.tsx`) and city hero
(`components/city/HeroSection.tsx`, now async) consume it; the ads hero has no
photo so it's untouched. Falls back to the bundled `/public/assets` images when
the blob token is missing, the folder is empty, or the list call fails — the
hero always renders. Dropping a new photo into the blob folder adds it to the
rotation with no code change (appears within the 5-min cache window; both hero
pages are `force-dynamic`). Needs `BLOB_READ_WRITE_TOKEN` set (already required
for the admin uploads). `next.config.js` already allows any `https` image host.

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

---

# Session Summary — IDX sync reliability (hourly 504 fix)

Branch: work done on `main` (owner directed). No migrations. Full lessons in
`docs/lessons-learned.md` §16.

## Problem
The hourly IDX sync never succeeded ("Last successful sync: Never"). Four causes
in sequence, each unmasking the next:
1. `idx:verify` CI: `getValidRealcompToken` required a DB (token cache) the verify
   job doesn't have.
2. verify then 400'd — `TaxYear` isn't in Realcomp's live `$metadata`.
3. hourly sync 504'd; a first pass added page-by-page + a 45s budget but also
   `$orderby` (the §13b server-sort timeout) which made it worse.
4. still 504 — every run frozen at `RUNNING`, no counts: a hard kill at the wall.

## Root cause
`idx-sync.yml` only `curl`ed `/api/cron/idx-sync`, a **Vercel function capped at
60s**. A feed-wide delta with full Media can't finish in 60s → 504, nothing
saved, cursor never advances, retries forever. The backfill takes ~2h fine
because it runs **on the runner** (350-min cap), not on Vercel.

## What changed (all on `main`)
- `lib/realcomp.ts`: `getValidRealcompToken` mints a token DB-free when no
  `DATABASE_URL` (via `mintRealcompToken`).
- `lib/idxSync.ts`: dropped `TaxYear` from `SELECT_FIELDS` (kept column + mapping);
  `runIdxSync` now streams page-by-page (Query 2 first), takes an optional
  `budgetMs` (default 45s for the serverless callers), marks a cut-short run
  `partial`; no `$orderby`.
- `scripts/idx-incremental-sync.ts` + `idx:sync:incremental` npm script: run the
  sync on the runner with `budgetMs: Infinity` (drains the whole delta), logging
  per-page progress.
- `.github/workflows/idx-sync.yml`: rewritten to run that script on the runner
  (DB + Realcomp secrets, `timeout-minutes: 60`) instead of pinging Vercel.
- `runIdxSync` now **flushes running Q1/Q2 counts to `idx_sync_log` every ~10s**
  as pages land, so a killed/aborted run leaves counts in the admin "Recent sync
  runs" table instead of a frozen `running` with `—/—`.
- **Bounded-window rewrite (the actual fix for the runner hang):** on the runner
  the job logged *nothing* for 1m39s → the first Realcomp request itself was
  hanging. Root cause: the backfill was days old, so the cursor was days behind,
  and Query 2's open-ended `gt cursor` feed-wide+full-Media pull made Realcomp
  materialize the whole multi-day result before page 1 (past the 5-min request
  timeout). `runIdxSync` now walks **1-hour `ModificationTimestamp` windows** from
  an `incremental` checkpoint (reusing `idx_backfill_checkpoints`), draining each
  window's Query 2 before advancing the checkpoint — small result sets, fast first
  page, gap-free resume, no `$orderby`. Query 1 (offices, tiny) runs once over the
  range advanced. Per-window progress logs to the runner's Actions output.
- **ROOT CAUSE of the silent hang (found via preflight + reading runner logs):** a
  freshly-minted Realcomp token isn't valid on the data API for ~1-2s — the first
  request 401s ("Token failed validation"), the next 200s (same token). The fetch
  loop force-re-minted on 401 via `mintRealcompToken`, which had **no timeout** on
  its auth fetch, so a stalled auth / churn of un-propagated tokens hung the sync
  for minutes. Fix (`lib/realcomp.ts`): 30s timeout on the token mint + a ~3s
  post-mint propagation `sleep` so the first request doesn't 401. Added
  `realcompPreflight()` (token + no-media/with-media probe, stderr, never throws)
  as a per-run health check. Media was NOT the cause (with-media returned 200).
- **FINAL CAUSE — Realcomp intermittently hangs the feed-wide request.** A probe
  fired the sync's EXACT query and got HTTP 200 in 1.2s (run #107); the identical
  query via `realcompFetchPages` the next run never returned a page in 90s (#108).
  Same query/token → the request itself intermittently stalls, and
  `REQUEST_TIMEOUT_MS` was 5 minutes, so one stall froze the whole run. Fix
  (`lib/realcomp.ts`): per-request `timeoutMs` on `realcompFetchPages`/
  `fetchWithTimeout`; the incremental sync uses 30s (runner) / 20s (serverless),
  so a stalled request aborts fast and the existing retry re-issues it. Real sync
  re-enabled in `scripts/idx-incremental-sync.ts`.
- **CONFIRMED it's Realcomp, not our code.** A reliability probe fired the exact
  feed-wide query 8× → **8/8 HTTP 200** (0.4–4.4s), yet 45 min earlier the same
  query aborted 4×. Realcomp's data API has **~20-minute degraded windows** that
  stall these queries then recover. The short-timeout + per-window-checkpoint
  design rides this out (a run that dies in a bad window resumes next hour). Real
  sync re-enabled; expect it to work whenever Realcomp is healthy.
- `lib/idxAdmin.ts`: `partial` counts as a non-failing success on the dashboard;
  admin **Run Now** page gets `maxDuration = 60`.

## Operational (must do before it works)
- The `IDX hourly sync` workflow now needs `DATABASE_URL` + the `REALCOMP_*`
  Actions secrets (same set the initial-sync workflow already uses) — the old
  `DEPLOY_URL`/`CRON_SECRET` are no longer used by it.
- Trigger `IDX hourly sync` (Actions → Run workflow) to confirm green; the admin
  IDX Sync banner should clear and "Last successful sync" should populate.

## IDX incremental-sync fix — the zero-record cause (round 2) + domain move

After the timeout/paging work above, the hourly sync still upserted **0 records
every run, silently** (HTTP 200, empty `value`, phantom `@odata.nextLink`). The
cursor never advanced, so ~3 days of solds/actives went missing.

- **Root cause (lessons §16b):** the full `$select` zeroed the query. A
  decomposition probe proved it wasn't media, the time window, or paging — a
  3-field select returned rows, the full ~90-field select returned 0. A per-field
  audit (`probeSelectFindAllBad()` in `lib/idxSync.ts`) then found **six fields
  that make Realcomp return 0 rows for ANY query that selects them, even alone:**
  `ArchitecturalStyle`, `InteriorFeatures`, `Appliances`, `ParkingFeatures`,
  `LotFeatures`, `AssociationAmenities`. All are in `$metadata` (they pass
  `idx:verify`), so metadata validation does not catch this. They were added in
  the `0021` buyer-fields expansion — AFTER the initial backfill — which is why
  incremental broke but the backfill was fine.
- **Fix:** dropped those six from `SELECT_FIELDS_ARR` (columns + mappings kept, so
  they light up automatically if Realcomp ever fixes the feed). Also dropped
  `PhotosCount` (a transient audit timeout, redundant with `$expand=Media`) and
  derived `photosCount` from the media-array length. Diagnostic exit removed from
  `scripts/idx-incremental-sync.ts` so the runner runs the real sync again.
- **Recovery:** ran the workflow's `since=2026-07-10` back-pull to fill the gap;
  the cursor advanced to current and the `:17` hourly job resumes normal
  incremental maintenance. Tests green (82), typecheck clean.
- **Follow-up (deferred):** the six dropped fields render as empty on listing
  pages until we fetch them via a separate query that doesn't select them
  alongside the rest.

### Production domain → `remax-platinumonline.com`
No app-code change: every canonical/OG/`metadataBase`/sitemap/robots/email URL is
env-driven off `SITE_URL`, whose fallback default is already
`https://remax-platinumonline.com`; `next.config` image `remotePatterns` allow all
https hosts; auth uses `trustHost: true` with host-scoped `__Secure-authjs`
cookies. The move is **env-vars + external config only** — see the domain answer
in-thread: set `SITE_URL` + `NEXTAUTH_URL` (Vercel) and `DEPLOY_URL` (Actions) to
the new domain, add/verify the domain in Vercel, extend the Google Maps browser
key's HTTP-referrer allowlist, register the new IDX display URL with Realcomp, and
add the domain in Google Search Console + resubmit the sitemap.
