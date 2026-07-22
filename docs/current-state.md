# RE/MAX Platinum Lead Platform — Current State

**Branch:** `claude/previous-session-items-q3l47m` (rebased from `leadgenv1.6`)
**Stack:** Next.js 14 (App Router) · TypeScript · Drizzle ORM · Neon Postgres · NextAuth v5 · Microsoft Graph email · RentCast AVM · **Realcomp IDX feed (RESO/OData)** · Tailwind
**Deploy target:** Vercel (serverless) + GitHub Actions cron
**As of:** the v1.6 addendum build + reviews/routing/**Scoring v2** + the **IDX feed integration** session + the **Listing/Valuation Fixes + IDX backfill hardening** session + the **Texting & Refinement** session (exit-intent autocomplete, wider hero field, redesigned sold-listing data-sheet page with a neighborhood-POI map) + the **IDX incremental-sync fix** (hourly delta was silently pulling 0 records — six `$metadata`-valid buyer fields zero the query; dropped them, back-pulled July 10→current, cursor advancing) + the **production domain move** to `remax-platinumonline.com` + the **Telnyx agent-texting** build (two-way SMS between the platform and agents — offer teaser/full client-info/update-due-reminder outbound, `YES`/`NO`/status-command/`STOP`/`START`/`HELP` inbound via a signature-verified webhook — replacing the dormant Twilio stub), its **post-review fixes** (phone-normalization fix for inbound matching, an agent-settings activation notice, a lead deep-link in client-info/reminder texts, and an SMS section in the privacy policy) + the **queue head start & portal score display** session (a one-time +50 rolling-365-only "starting credit" on first activation, and the agent portal now shows all four score tracks with a next-slot progress meter); migrations `0006–0025`

This document explains what the system is, what it does, and how it works, so anyone (human or AI) can orient quickly before testing or extending it.

---

## 1. What it is

A single Next.js application that does three jobs for a Southeast-Michigan real-estate brokerage:

1. **Generates seller leads** through SEO city landing pages and PPC ad pages that offer a free instant home valuation.
2. **Routes each lead to an agent** via a weighted, proximity-first round-robin with a timed offer/accept lifecycle and a gamified agent score.
3. **Gives the brokerage a back office** — an admin console (leads, agents, offices, locations/SEO/content, market-data import, analytics, API/email monitoring, routing queue) and an agent portal (accepted leads, status updates, availability, score).

It is a rebuild of an older Manus-hosted system. This build intentionally omits some legacy capabilities (BoldTrail CRM sync, AI chat, S3 photo upload, the Manus "Forge" platform features) — see `feature-inventory-audit-v1.6.md` for the full comparison and the addendum's explicit exclusions. (SMS was originally excluded too; a later Telnyx-based agent-texting build added it — §4.7.)

---

## 2. High-level architecture

```
Public visitor ──▶ /sell/[slug] (SEO) or /ads/[slug] (PPC)
                     │  ValuationForm (2 steps)
                     ├─▶ POST /api/leads/partial  (address only, by sessionId)
                     ├─▶ POST /api/valuation      (RentCast AVM, logged)
                     └─▶ POST /api/leads/submit   (email required)
                            │ dedup (contact → address) → lead row
                            │ lead_events: valuation_submitted
                            │ autoOfferLead() ─────────────┐
                            └─ homeowner confirmation email │
                                                            ▼
                              Routing engine (lib/routing + lib/queue)
                              weighted proximity-first round-robin
                                     │ creates lead_offers row
                                     │ within 7am–8pm ET? send : queue
                                     ▼
                            Agent offer email (accept/decline links)
                              GET /api/offer/[token]?response=…
                                     │ accept → score + auto-login → portal
                                     │ decline → −3 + reassign
                                     ▼
                              Agent portal /agent/leads
                              status updates, reorder, availability, ScorePanel

Cron (GitHub Actions every ~10 min + Vercel daily):
  dispatch-queued-offers · expire-offers (3h) · followup-check
  (48h escalation, weekly reminder, 36h/48h/6d/7d stale) · broker-digest (Thu)
  · cleanup-rate-limits
```

Everything is one deployable. API route handlers are `runtime=nodejs, dynamic=force-dynamic`. Admin mutations are React Server Actions guarded by `requireAdmin()`. The DB client (`lib/db.ts`) is lazy so `next build` succeeds without a live database.

---

## 3. Data model (Postgres, `drizzle/schema.ts`)

Core lead flow:
- **leads** — one row per homeowner. Partial (address only, keyed by `sessionId`) upgrades to complete on submit. Holds contact, property, valuation estimate/range, `pageVariant` (`seo`/`ads`), `source`, full attribution (UTM/gclid/gbraid/wbraid/referrer/device/first+lastSeen), `normalizedAddress` (dedup key), soft-delete, and the stale-clock fields `staleWarningSentAt`/`lastPenaltyAt`. Lifecycle v2 (spec v2 §4): `status` enum adds `reopened`; `contactedAt` (Lost precondition), `lostReason`/`lostAt`, `stallPenaltyAt` (30-day recurrence), `reopenedAt`. `intent` (migration 0026) — buyer/seller classification (`seller`/`buyer`/`unknown`, default `seller`), a label only (no routing impact). **Scoring v4 (migration 0027):** the `status` enum gains `connected`/`nurturing`/`appointment_set`/`signed` (v2's `contacted`/`qualified`/`working` retired but kept, since Postgres can't drop enum values); `update_deadline` (unified clock), `first_engagement_logged` + four `milestone_*` booleans (once-only guards), and `reactivation_count` (Lost→Reopened, reporting).
- **lead_offers** — routing output. One row per offer to an agent; token (64-hex, 7-day), `offerSentAt` (null = queued), accepted/declined/expired/responded timestamps, `firstUpdateDue` (+48h), `nextReminderDue` (+7d), `distanceMiles`. Status enum includes `closed_manual` (admin override).
- **lead_events** — full lifecycle timeline (`address_entered`, `valuation_submitted`, `duplicate_submission`, `offer_sent/accepted/declined/expired`, `manually_assigned`, `status_updated`, `appointment_requested`).
- **status_updates** — agent pipeline updates per offer.
- **appointment_requests** — thank-you scheduling requests (+ attribution).

Agents & routing:
- **agents** — roster; **four score tracks** (`scoreLifetime`/`scoreYtd`/`scoreMonthly`/`scoreRolling365`, uncapped; `score` kept as a lifetime mirror), `isActive` (admin) + `isAvailable` (agent self-toggle), magic-link token, optional password hash. Per-agent proximity: `proximityAnchor` (`office`|`custom`), `locationCity` (geocoded → `latitude`/`longitude`), `proximityRadiusMiles` (null → global default). Texting (migration `0024`): `smsOptOut`/`smsOptOutAt` (set by an inbound `STOP`, cleared by `START`); their cell is `phone`, the lookup key inbound texts identify them by — normalized to E.164 on every admin write (create/update actions), and the inbound webhook now matches by normalized comparison so an un-normalized legacy row still matches (§4.7). `startingCreditGrantedAt` (migration `0025`) — set the first time this agent activates; guards the one-time queue head start (§4.3) from re-granting.
- **offices** — routing anchors (agent coords fall back to office coords) **and** per-office Google Business Profile: `googlePlaceId`, cached `googleReviewRating`/`Count`/`FetchedAt`/`Error`; texting: `telnyxNumber` (the office's outbound "from" number, migration `0024`).
- **agent_score_log** — immutable score audit; every delta with reason enum (adds `pipeline_stalled`, and `starting_credit` for the one-time +50 queue head start, migration `0025`), optional `isNegated`/`negatedReason` for deletion reversals. Source for the rolling-365 sum.
- **sms_messages** (migration `0024`) — audit of every SMS in or out: `direction` (inbound/outbound), `agentId`/`leadId`/`officeId`, `fromNumber`/`toNumber`, `body`, `kind` (offer_teaser/client_info/update_reminder/command_ack/help/optout_ack/inbound…), `telnyxMessageId`, `status` (sent/delivered/failed/received, updated by inbound delivery-receipt events), `errorMessage`. Mirrors `email_send_log`'s role for the SMS channel.
- **agent_queue** — persisted rotation (`rotationList` JSON, front = next; `pointer` vestigial). Slots interleaved; reconciled in place on roster/score change (never rebuilt from scratch except the admin "Rebuild" button); served slot moves to the back, distance-skipped slots hold at the front.
- **agent_lead_order** — the agent's custom drag order of their accepted leads.

Content & marketing:
- **locations** — city pages: slug, SEO copy (`metaTitle/metaDescription/heroHeadline/heroSubheadline/faqJson/guideUrl`), `schoolDistrict` (matches closings → stats), `socialProofCount`, manual Google review fields, and `officeId` (FK → offices; which office's Google reviews power this city page, else pooled).
- **market_stats** (per location) and **home_page_metrics** (single row) — recomputed from closings.
- **recent_sales** — showcase rows; manual or `isAutoPopulated` (linked to a `closingId`).
- **testimonials**, **neighborhood_links**, **tracking_scripts**.

Market data:
- **closings** — imported MLS transactions (listing/buyer role, list/sale price, DOM, school district, % of list, MLS number). **Legacy:** superseded by the IDX feed; CSV Data Upload + Recent Sales admin are deprecated (public metrics/recent-sales prefer `idx_listings` office deals, falling back to `closings`).
- **upload_batches** — one row per CSV import with counts and date range.

IDX feed (Realcomp RAPI v2.4 — migration `0015`, spec `docs/idx-build-summary.md`):
- **realcomp_tokens** — persisted OAuth token (single row by `provider`), MS-Graph pattern.
- **idx_listings** — local mirror of Realcomp listings (~60 cols), upsert key `listingKey`. Compliance flags `internetEntireListingDisplayYN`/`internetAddressDisplayYN`; computed `isOfficeListing` (true if any of list/buyer/co-list/co-buyer `*OfficeMlsId` ∈ `REALCOMP_OFFICE_KEYS`). No stale deactivation — trust `standardStatus`.
- **idx_listing_photos** — full Media set per listing (display gated: full gallery for Active, primary-only for Pending/Closed per §18.10).
- **idx_sync_log** — one row per sync run with separate Q1/Q2 fetch/upsert counts.
- **leads** additions — `reportToken` (durable Full-Valuation-page link), `reportFirstAccessedAt`/`reportViewCount` (admin market-report access log). The `/api/valuation` route also backfills `estimatedValue`/`priceRangeLow`/`priceRangeHigh` onto the matching **unnamed** (address-only, `email IS NULL`) partial lead — the numbers only, never `valuations.leadId` (which would open the reveal gate).

AVM/market/backfill tables (Listing/Valuation-Fixes session):
- **property_records** (migration `0018`) — cached AVM-provider property record (owner of record, tax/assessment, full building detail) keyed by normalized address, so repeat lead-detail opens + the admin lookup tool don't re-bill the provider. `lib/propertyRecords.ts` dispatches to the active provider (ATTOM `property/expandedprofile`, RentCast `/properties` fallback), caches raw+parsed JSON, and logs each call to `api_usage_logs`.
- **market_narratives** (migration `0019`) — cached AI market-report copy keyed by `lower(city)`, regenerated only when the stats `signature` changes (`lib/marketNarrative.ts`).
- **idx_backfill_checkpoints** (migration `0020`) — per-job resume cursor (`last_mod_ts`) for the resumable initial backfill; a failed run leaves it, a clean run clears it.

Ops/infra:
- **api_usage_logs** (RentCast calls, enriched with success/response-time/estimate), **rate_limits** (Neon fixed-window), **ms_graph_tokens** (persisted OAuth token), **email_send_log** (every send), **api_keys** (bcrypt-hashed webhook keys), **google_reviews** (cached Places reviews, keyed by `place_id`), **notification_settings** (single-row config: notification email, offer-window hours, proximity radius, queue pointer, testimonial source + `googlePlaceId`, and the `scoreMonthly/YtdResetKey` maintenance-cron guards).

Migrations are hand-authored idempotent SQL in `drizzle/migrations/` and registered in `meta/_journal.json`. Current head is **`0028_scoring_v4_backfill`** — the **Scoring v4** rebuild (`0027_scoring_v4` adds the `connected`/`nurturing`/`appointment_set`/`signed` statuses, the `fast_engagement`/`milestone_appointment_set`/`milestone_signed`/`missed_update_checkin` score reasons, and `leads.update_deadline`/`first_engagement_logged`/`milestone_*`/`reactivation_count`; `0028` maps the retired v2 statuses over). See `docs/agent-rating-system.md` + `docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md`. Before it, **`0026_lead_intent`** — the `lead_intent` enum (`seller`/`buyer`/`unknown`) + `leads.intent` (default `seller`), a **label-only** buyer/seller classification. And **`0025_agent_starting_credit`** — adds `agents.starting_credit_granted_at` and the `starting_credit` score-reason value for the one-time queue-head-start credit (§4.3). **`0024_telnyx_sms`** adds `offices.telnyx_number`, `agents.sms_opt_out`/`sms_opt_out_at`, and the `sms_messages` table for the Telnyx agent-texting build (see §4.7). **`0023_lead_status_working`** (a prior refinement batch) added two lead-pipeline stages (`attempted_contact`, `working`) and a `pipeline_attempted` score reason. Before that, **`0022_area_poi_cache`** (Texting/Refinement session added **`0021_idx_buyer_fields`** — ~35 buyer-relevant RESO columns on `idx_listings`: HOA fee/frequency/includes/amenities, taxes, heating/cooling, fireplaces, laundry, interior/exterior features, appliances, flooring, construction, roof, foundation, parking, pool, patio, lot features, water source, sewer, utilities, style, levels/stories, rooms, view, zoning, new-construction; and **`0022_area_poi_cache`** — cached Google-Places neighborhood POIs keyed by a coarse coordinate grid cell). The Listing/Valuation-Fixes session added **`0017_idx_widen_urls`** (photo/tour/media URL columns → `text`), **`0018_property_records`** (cached AVM property records), **`0019_market_narratives`** (cached AI market-report copy), and **`0020_idx_backfill_checkpoints`** (resumable-backfill cursors); **`0016_idx_widen_text`** widens overflow-prone `idx_listings` text columns; **`0015_idx_integration`** added the IDX tables + leads report columns; the scoring/reviews/proximity work spans **0006–0014** (valuations `0006–0007`, google reviews `0008`, per-office reviews `0009–0010`, location→office `0011`, agent proximity `0012`, scoring v2 `0013`, rolling-365 rename `0014`). **Apply them in order on every DB** — several admin pages `select` the whole `agents`/`leads` row, so one skipped migration in the middle breaks those pages.

---

## 4. Key subsystems and formulas

### 4.1 Valuation (`lib/rentcast.ts`)
RentCast AVM `GET /avm/value`. Returns estimate + range (RentCast's own range, or **±8%** fallback — kept per addendum §K.2) + lat/lng. Every call is logged; a **40/50 monthly free-tier alert** email fires once when the 40th call of the month lands.

### 4.2 Routing (`lib/routing.ts`, `lib/queue.ts`, `lib/autoOffer.ts`)
- **Slot weight** = `max(1, min(5, 1 + floor(score/15)))` (1–5 slots).
- **Rotation** = each eligible agent's slots, **interleaved** (each slot placed at fractional position `(k+0.5)/slotCount`, merged and sorted) so an agent's turns are spread through the list — a newly-activated agent weaves in rather than clustering at the end. A persisted custom order (`agent_queue`) is honored.
- **Reconciled in place, never auto-rebuilt** (`reconcileRotation`): on a roster/score change the live queue is preserved — existing slots keep their order (and move-to-back progress), new agents / score-increase slots are woven in evenly, and removed-agent / score-decrease slots drop out. The only from-scratch rebuild is the admin's explicit "Rebuild" button.
- **Move-to-back queue**: the list is self-ordering, **front = next** (`pointer` is vestigial, always persisted as 0). Serving a lead moves the **one served slot to the back**; slots skipped for distance **stay at the front** so those agents are reconsidered first next lead (a distance skip never costs an agent their turn). This intentionally means the order is not stable across leads.
- **Per-agent proximity** (`agents.proximityAnchor`/`locationCity`/`proximityRadiusMiles`): each agent picks the **anchor** their acceptance distance is measured from — their **office** or a **custom city** (entered by name, geocoded to lat/lng) — and their own **radius** (miles; null → the brokerage default `notification_settings.proximityRadiusMiles`, 20). Set in the agent portal (`/agent/settings`) or the admin agent editor.
- **Proximity-first**: an agent joins the proximity pool when the lead is within *that agent's own* radius of *their* anchor (haversine). Scan the queue from the front and serve the first pool member. **Outside-area handling:** if the lead has coordinates and at least one agent is geocoded but the lead is within *no* agent's radius, `recommendAgents` returns `outcome: 'outside-area'` (agent `null`) and `autoOfferLead` leaves the lead **unassigned**, emailing the admin the lead details (`leadOutsideAreaEmail`) so they handle it directly — it is deliberately NOT dumped on a far agent. The global-queue fallback (serve the front slot) now applies only when proximity is *unevaluable*: no lead coords, or no agent geocoded.
- **No capacity cap** — by owner decision, an agent keeps receiving offers regardless of active-lead count (the `MAX_LEADS` gate is intentionally never built).
- **Offer window** 7am–8pm ET; outside the window the offer is created but `offerSentAt` stays null and the dispatch cron sends it at the next open.
- **Acceptance** deadline = send + 3h.

### 4.3 Agent score — Scoring v4 (Seller Track; `lib/scoring.ts` + `lib/statusUpdates.ts`, uncapped; see `docs/agent-rating-system.md`)
Four tracks per agent, all written by `applyScore`: **lifetime** (never resets, tier label, private), **YTD** (Jan 1), **monthly** (1st), **rolling-365** (trailing-365d log sum, drives routing only). No clamp. **v4 rebuilt the point table around the Seller Track status flow** (`new`→`attempted_contact`→`connected`→`nurturing`→`appointment_set`→`signed`→`closed`, plus `lost`/`reopened`; transitions enforced by `ALLOWED_TRANSITIONS`).

| Event | Delta | Event | Delta |
|---|---|---|---|
| Accept <15 / 15–30 / 30–60 / 1–3h | +4 / +3 / +2 / +1 | Appointment Set (1st) | +4 |
| Decline | −3 | Signed (1st) | +10 |
| No response (expired) | −4 | Closed (Won) | +25 |
| Fast-engagement (1st Attempted/Connected) | +4/+3/+2/+1/0 | Nurturing / Lost | 0 |
| Attempted Contact (1st) | +1 | Missed update-clock check-in | −2 (recurs) |
| Connected (1st) | +2 | — | — |

**Milestones pay once per lead** (atomic `claimLeadMilestone` on `leads.milestone_*`), so backward/forward reactivation cycles never re-pay; the fast-engagement bonus is also once (`first_engagement_logged`). Slots = `1 + floor(sqrt(max(rolling365,0)/10))` (unchanged). Tiers are **cohort-relative percentiles** of active agents' lifetime score (`lib/scoreTiers.ts`). Leaderboards at `/agent/leaderboard` (monthly + YTD, top 20 + your rank). Admin **Lost-reason roll-up** at `/admin/lost-reasons`.

**Queue head start (migration `0025`, `lib/scoring.ts grantStartingCreditIfFirstActivation`):** the first time an agent flips themselves Available (`POST /api/agent/availability`), they get a one-time **+50 "starting credit"** — **rolling-365 ONLY**, so it affects queue slots but never lifetime/tier, monthly, or YTD (leaderboards untouched). Implemented as a direct `agent_score_log` insert (reason `starting_credit`) followed by `recomputeRolling365` — never through `applyScore`, which would also bump the other three tracks; `resolveScoreDelta` throws if `starting_credit` is ever passed to it, making "rolling-only" a structural guarantee rather than a convention. One-time-ness is enforced by an atomic `UPDATE agents ... WHERE starting_credit_granted_at IS NULL RETURNING id` claim (concurrent double-toggles can't double-grant), and the credit naturally decays out of the 365-day window ~1 year after *that agent's* activation (not system launch). Existing already-active agents are not bulk-backfilled — they receive it on their next activation toggle. Best-effort: a failure here is logged and swallowed, never blocks the availability toggle itself.

**Portal score display** (`GET /api/agent/score`, `components/agent/ScorePanel.tsx`): shows all four tracks with plain labels so agents can tell them apart — **Queue Score** (rolling-365, the hero number) with a "N slot(s) in the lead queue" readout and a "{X} more points to gain another slot in the queue" progress meter (thresholds derived from the slots formula: `slots = 1 + floor(sqrt(score/10))` ⇒ score-for-`s`-slots `= 10*(s-1)²`), **Tier** (from lifetime, badge only), **This Month** (monthly leaderboard track), **Year to Date** (ytd track). The old v1 `SCORE_MAX = 200` cap/bar (a stale 0–200 scale left over from before Scoring v2 went uncapped) is gone. `scoreReasonLabel` gained "New-agent head start" for the `starting_credit` reason in the score-history log.

**Lifecycle (v4):** **Lost** is one status with **origin-scoped reason lists** (Lost A/A2/B/C/D by the stage left; A2 "no response after 6" gated at ≥6 attempts), 0 points, no clawback. Backward moves (Appointment Set/Signed → Nurturing) are manual, reason-free, timeline-only (no points/counter). **Reopen** flips a resubmitted Lost lead to **Reopened** (behaves like New), bumps `reactivation_count` (a reporting-only Lost→Reopened counter), restarts the clock, but preserves `milestone_*` (no re-pay). `/api/cron/score-maintenance` (daily) decays rolling-365 and resets monthly/YTD at boundaries.

### 4.4 Unified update clock (cron `followup-check`)
v4 replaced the three stale rules (`stale_48h`/`stale_7day`/`stalled_30day`) with **one `update_deadline` clock**: 24h from accept, then +7d per update (+14d once Signed), null (stops) at Closed/Lost. Overdue → flat **−2 `missed_update_checkin`**, deadline re-armed (recurs once per cycle). A **pre-deadline warning email** fires ~24h out (reuses `staleWarningSentAt` for per-cycle dedup). A status change counts as an update. **Kept unchanged:** 48h broker escalation, weekly agent reminder, Thursday broker digest.

### 4.5 Market data → stats (`lib/csvClosings.ts`, `lib/metrics.ts`)
CSV import maps ~13 header aliases, parses multi-format dates and `$`/comma money, dedups by MLS number per role, and records a batch. `updateAllMetrics` then recomputes homepage + per-location stats over the 2025 window (all-time fallback) and diff-populates the top-3 listing-side recent sales per district without overwriting photos or manual rows.

### 4.6b IDX feed (`lib/realcomp.ts`, `lib/idxSync.ts`, `lib/idx.ts`, `lib/idxMetrics.ts`)
- **Auth/fetch** (`lib/realcomp.ts`): OAuth client-credentials token persisted to Neon; `realcompFetch`/`realcompFetchPages` paginate via `@odata.nextLink`. Account-specific values (all env-overridable): host `idxapi.realcomp.com/odata`, token `auth.realcomp.com/Token`, **audience `rcapi.realcomp.com`**. **Self-healing auth:** the persisted token is reused until ~5 min pre-expiry, but a `401` triggers a one-time forced re-mint (`getValidRealcompToken(true)`) + retry, so a token cached during a transient misconfig (e.g. a blank audience) can't wedge the sync — env getters use `||` (not `??`) so an empty secret falls back to the default rather than overriding it.
- **Sync** (`lib/idxSync.ts`, `runIdxSync`): walks forward in **bounded 1-hour `ModificationTimestamp` windows** from a checkpoint (`idx_backfill_checkpoints` key `incremental`, seeded from the DB's max cursor). Per window: Query 2 = all Active/Pending/Closed feed-wide, upserted **page-by-page**; the checkpoint advances only after a window fully drains (gap-free resume, no `$orderby`). Query 1 = your offices, ALL statuses (per-field `*OfficeMlsId in (...)`, split under IIS's ~2KB URL limit), pulled once over the range advanced that run. An **open-ended `gt cursor` feed-wide query does NOT scale** — Realcomp materializes the whole result before page 1, so a multi-day delta hangs the first request past the 5-min timeout (lessons §16); windows keep every result set small. Live Q1/Q2 counts flush to `idx_sync_log` every ~10s. Defensive field mapping (`mapRealcompListing`): city from `OriginalPostalCity`, county humanized, `WaterfrontFeatures` enum→CSV, Media→photos. No stale deactivation.
  - **Where it runs:** the hourly job (`idx-sync.yml`) runs the sync **directly on the GitHub runner** (`npm run idx:sync:incremental` → `scripts/idx-incremental-sync.ts`, `budgetMs: Infinity`), NOT by pinging Vercel. The old design curled `/api/cron/idx-sync`, a Vercel function hard-capped at 60s, which a feed-wide delta can't finish → permanent 504 loop (see lessons §16). The `/api/cron/idx-sync` endpoint + admin **Run Now** (`runSyncNow`) still call the same `runIdxSync` but keep the 45s serverless budget (they mark a cut-short run `partial`). Initial backfill via manual GitHub Actions workflow (`scripts/idx-initial-sync.ts`). A one-time back-pull is available via the workflow's **`since` input** (`YYYY-MM-DD`) → `runIdxSync(..., { sinceIso })`, used to fill a data gap and let the cursor advance forward from there.
  - **Six buyer fields are NOT `$select`able (lessons §16b):** `ArchitecturalStyle`, `InteriorFeatures`, `Appliances`, `ParkingFeatures`, `LotFeatures`, `AssociationAmenities` are in `$metadata` (they pass `idx:verify`) but make Realcomp return **0 rows + a phantom `@odata.nextLink`** for any query that selects them — even alone. This silently zeroed the incremental sync (the first job to use the post-`0021` expanded select) while the pre-expansion backfill was fine. They're dropped from `SELECT_FIELDS_ARR` (columns/mappings kept as harmless null); pinpointed by `probeSelectFindAllBad()`. `PhotosCount` is also dropped (a transient audit timeout, redundant with `$expand=Media`) and `photosCount` is derived from the media-array length. Repopulating the six needs a separate query that doesn't select them alongside the rest (TODO).
- **Reads** (`lib/idx.ts`): `getSimilarHomes` (Active near subject), `getRecentSoldComps` (Closed ≤90d), `getCityMarketStats` (median DOM/price, sale-to-list, months of inventory), all with the IDX display gates baked in.
- **Metrics** (`lib/idxMetrics.ts`): `updateMetricsFromIdx()` recomputes `home_page_metrics` + `market_stats` from office-closed deals — guarded (no-op until backfilled), so it never zeros live stats.
- **Compliance** (`lib/idxDisclosures.ts`, `components/idx/*`): Realcomp logo + office credit on every card, all required disclaimers, no RE/MAX branding in listing bodies.

### 4.6 Conversion tracking (`lib/googleAdsConversions.ts`, `lib/attribution.ts`)
Four Google Ads conversions fire client-side after a confirmed save (Seller Valuation $100, Hero/PPC $75, Seller Guide $20, Appointment $150), with enhanced-conversion user data and transaction-id dedup (prefixed `hero-`/`appointment-`). Attribution is captured on every public page load and persisted on each lead. GA4/Clarity load via GTM on public pages only.

### 4.7 Agent texting (`lib/sms.ts`, `lib/agentSms.ts`, `lib/smsCommands.ts`, `lib/telnyxSignature.ts`, `lib/smsTemplates.ts`, `lib/officeNumbers.ts`, `lib/smsMessages.ts`, `POST /api/webhooks/telnyx`)
**Telnyx-only** (the dormant Twilio stub is gone). Email is still the source of truth for every notification; SMS is additive and degrades to a silent no-op when unconfigured, when the agent has no `phone`, or when they've opted out — no code path depends on a text actually sending.
- **Outbound** (`lib/agentSms.ts sendAgentSms`), always from the agent's home-office `offices.telnyx_number` (fallback `TELNYX_DEFAULT_FROM`): a reply-based **offer teaser** (no PII) on a new offer, the **full client-info text** on accept/manual-assignment (`lib/clientInfoSms.ts sendClientInfoSms`, shared by the web accept-flow and the inbound `YES` command), and an **update-due reminder** at the 48h first-update-overdue point (the `followup-check` cron). The client-info and update-reminder texts each include a **deep link** to `/agent/leads/<leadOfferId>` (threaded through the offer-accept, manual-reassign, and 48h-escalation call sites) so the agent can jump straight to the lead from the text. Every send/skip/failure is logged to `sms_messages`.
- **Inbound** (`app/api/webhooks/telnyx/route.ts`): Ed25519 signature verification (`lib/telnyxSignature.ts`), **fail-closed** — a bad/missing signature returns `401` before the body is even parsed; everything past the gate returns `200` (Telnyx retries non-2xx) even on an internal error. The sender's E.164 number looks them up in `agents.phone`; unrecognized senders and unrecognized commands are forwarded to the owner by email rather than silently dropped. Grammar (`lib/smsCommands.ts parseCommand`, spec §6.3): `YES`/`NO [lead#]` (accept/decline, via the shared `lib/offerActions.ts applyAccept/applyDecline` core also used by the web offer-response route), multi-word status phrases like `CONTACTED`/`LEFT VM`/`QUALIFIED`/`WORKING`/`CLOSED`/`LOST [lead#] [notes]` (via the shared `lib/statusUpdates.ts recordStatusUpdate`, also used by the agent portal), and `STOP`/`START`/`HELP` (opt-out, gates all future sends). All authorization is scoped to the sending agent's own offers. Delivery-receipt events (`message.sent`/`finalized`/`failed`) update the matching `sms_messages.status` by `telnyxMessageId`.
- **Phone-format seam, fixed post-review:** the admin agent create/update actions now normalize `agents.phone` to E.164 on write (fallback to the raw value if unparseable), and the inbound webhook matches senders by **normalized comparison in JS** (not a raw exact-match) so legacy un-normalized rows (e.g. `(810) 555-0134`) still match — before this fix, un-normalized stored phones silently dropped matching agents' replies to "unrecognized sender." The SMS audit log (`sms_messages`) now records the normalized number actually dialed. Also cleaned up as part of the same fix: an agent-settings **activation notice** near the availability toggle ("activating enables text-message lead notifications"), the unused `telnyxConfigured()` export removed from `lib/sms.ts`, and a stale "accept link" code comment in `lib/autoOffer.ts` corrected to describe the reply-based teaser it actually sends.
- **Shared cores**: `lib/offerActions.ts` and `lib/statusUpdates.ts` were extracted so the web UI and SMS commands run identical accept/decline/status-update logic — one behavior, two entry points (same pattern as the exit-intent/hero valuation handoff, §14 lessons). `lib/clientInfoSms.ts` is its own module (not folded into `offerActions.ts`) to avoid a circular import between the offer core and the SMS layer.
- **Privacy policy** (`app/privacy/page.tsx`) gained a dedicated **SMS / text-messaging section** (the carrier-required 10DLC clause): opt-in/opt-out mechanics, message-frequency disclosure, and an explicit statement that mobile numbers and SMS opt-in consent are not shared or sold to third parties.
- **Owner setup (not code):** one Telnyx number is provisioned now (`TELNYX_DEFAULT_FROM`, the fallback "from" address every office uses until it has its own); **per-office numbers are a later step**, needed only once Local Services Ads goes live per-office (each additional number requires its **own separate 10DLC campaign registration**, not a shared one). Complete 10DLC/toll-free carrier registration before go-live, set `TELNYX_API_KEY`/`TELNYX_PUBLIC_KEY`(/`TELNYX_MESSAGING_PROFILE_ID`/`TELNYX_DEFAULT_FROM`), populate `offices.telnyx_number` per office as they're added, point the Telnyx portal's inbound webhook at `/api/webhooks/telnyx`. Full walkthrough in `SETUP.md` §7. Live send/receive could not be exercised in this code-only session — no Telnyx credentials in the sandbox — so this is the owner's first-connection step, same as the IDX feed and Google Places before it.

---

## 5. Surfaces

**Public:** `/`, `/sell`, `/sell/[slug]` (SEO money page, ISR, JSON-LD, dynamic OG image; now also a "Verified Google Reviews" section from the linked office), `/ads/[slug]` (PPC, noindex), **`/thank-you` — the "Full Valuation page"** (revealed estimate + confidence hero, condition refiner, then IDX Similar Homes For Sale / Recently Sold / Market Report; reached via the `reportToken` in the redirect + confirmation email; the Market Report is now the redesigned brokerage card with a YoY/12-month trend and an AI-written, dash-free summary), **`/listing/[listingKey]`** (IDX listing detail — redesigned "data sheet": photo hero with status/price overlay, dark stat bar, beds/baths/sqft/year row, feature chips, two-column Interior/Lot detail from the expanded feed, **Neighborhood Highlights** map + nearby-POI cards (restaurants/parks/coffee/etc., no schools, Google Places cached), a sold-only "How this home compared" block + full Market Report card, and a seller CTA; full gallery for Active + ActiveUnderContract, primary photo only for Pending/Closed per §18.10, office credit/logo/copyright; **noindex** unless `IDX_INDEX_LISTINGS=1`), `/privacy`, `/terms`. CRO: exit-intent overlay + sticky CTA. Homepage below-hero metrics + city Market-Stats bar now share one component/metric set; the site footer address resolves to the page's linked or closest office (default Brighton).

**Admin (`/admin/*`, NextAuth):** Overview · Leads · **Property Lookup** (enter any address → full AVM property record incl. owner, with a cache-busting refresh) · Round-Robin (drag-reorder) · **Lost Reasons** · Leads/new · Agents · Offices (+ Google Place ID & review status) · Locations · **IDX Sync** (status, counts, coverage, Run Now) · **IDX Listings** (read-only browser) · **Market Reports** (who opened their report) · Analytics · API Usage · Email Log · API Keys · Settings. (Data Upload + Recent Sales retired — see IDX feed.) The agent + admin **lead detail** pages now show the full "About this home" AVM record (owner of record, tax/assessment, building detail; no raw JSON, values title-cased).

**Agent (`/agent/*`, signed session cookie):** login · leads dashboard (KPIs, ScorePanel = all four score tracks — **Queue Score** (rolling-365) hero with a slots readout + next-slot progress meter, **Tier** (lifetime), **This Month** (monthly), **Year to Date** — filter tabs, drag reorder, availability toggle — flipping Available for the first time grants a one-time +50 queue-only "starting credit", §4.3) · pipeline · performance · **leaderboard** (monthly + YTD, top 20 + your rank) · **settings** (proximity anchor: office or a geocoded city, + acceptance radius; now also shows an activation notice that enabling availability turns on text-message lead notifications) · lead detail (contact, status update with Lost-reason picker, history).

**External:** `POST /api/webhooks/lead` and `/api/webhooks/appointment` (bcrypt API-key auth) for third-party lead sources; `POST /api/webhooks/telnyx` (Ed25519 signature auth, fail-closed) for inbound agent texts and delivery receipts — see §4.7.

---

## 6. Auth & security
- Admin = NextAuth credentials (env `ADMIN_USERNAME` + bcrypt `ADMIN_PASSWORD_HASH`, no user table).
- Agent = magic-link (64-hex, 30-day) or email+password, plus a signed HMAC session cookie (edge-verified in middleware).
- Webhooks = `rpk_` API keys (bcrypt-hashed) for `/api/webhooks/lead`/`appointment`; `/api/webhooks/telnyx` uses Ed25519 signature verification instead (`telnyx-signature-ed25519`/`telnyx-timestamp` headers against `TELNYX_PUBLIC_KEY`), fail-closed — an invalid signature is rejected `401` before the body is parsed. Cron = `x-cron-secret`. Revalidate = `x-revalidate-secret`.
- Inbound SMS commands are agent-scoped: the sender is identified by matching their E.164 number against `agents.phone`, and every accept/decline/status action only ever targets that agent's own `lead_offers` rows.
- Rate limiting = Neon fixed-window per (ip, endpoint, window), fail-open. Strict CSP + security headers in `next.config.js`.

---

## 7. Environment variables
`DATABASE_URL` (or any Neon/Vercel alias) · `NEXTAUTH_SECRET` · `NEXTAUTH_URL` · `ADMIN_USERNAME` · `ADMIN_PASSWORD_HASH` · `MS_GRAPH_CLIENT_ID/SECRET/TENANT_ID/FROM_EMAIL/ADMIN_EMAIL` (or `MICROSOFT_*` aliases) · `RENTCAST_API_KEY` · `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` · `NEXT_PUBLIC_GTM_ID` · `NEXT_PUBLIC_CLARITY_PROJECT_ID` · `SITE_URL` · `CRON_SECRET` · `REVALIDATE_SECRET` · **IDX:** `REALCOMP_CLIENT_ID`/`_SECRET` · `REALCOMP_BASE_URL` (`https://idxapi.realcomp.com/odata`) · `REALCOMP_AUTH_URL` (`https://auth.realcomp.com/Token`) · `REALCOMP_AUDIENCE` (`rcapi.realcomp.com`) · `REALCOMP_OFFICE_KEYS` (comma list of **OfficeMlsId** values). **AVM/AI (Listing/Valuation-Fixes session):** `VALUATION_PROVIDER` (`attom`|`rentcast`, default rentcast — currently `attom`) · `ATTOM_API_KEY` (property records use ATTOM `property/expandedprofile`, which must be on the plan) · `ANTHROPIC_API_KEY` + optional `ANTHROPIC_MODEL` (market-report narrative; falls back to a written template without it) · `IDX_INDEX_LISTINGS=1` to let `/listing/[listingKey]` be indexed (noindex otherwise) · **`LISTING_AREA_POI`** (`0` disables the listing-page Neighborhood-Highlights POI section; default on when a Google server key is present — needs the **legacy Places API** + billing for Nearby Search, and the **Maps Embed API** for the embedded map) · **Telnyx agent texting:** `TELNYX_API_KEY` · `TELNYX_PUBLIC_KEY` (verifies inbound webhook signatures — required for `/api/webhooks/telnyx` to accept anything) · optional `TELNYX_MESSAGING_PROFILE_ID` / `TELNYX_DEFAULT_FROM` (fallback "from" number when an office has none set); unset = the whole feature no-ops silently (see §4.7) · `DEPLOY_URL` (GitHub Actions secret; the served app URL, no trailing slash — set to the production domain `https://remax-platinumonline.com`). **Production domain:** `remax-platinumonline.com` — every canonical/OG/sitemap/robots/email URL is env-driven off `SITE_URL` (fallback default already `https://remax-platinumonline.com`); `NEXTAUTH_URL` must match it. No domain is hard-coded in app code, so a domain change is env-vars + external config only (Vercel Domains, `SITE_URL`/`NEXTAUTH_URL`/`DEPLOY_URL`, Google Maps key HTTP-referrer allowlist, Realcomp IDX display-URL registration, Search Console). `trustHost: true` + host-scoped `__Secure-authjs` cookies mean auth needs no code change.

> ⚠ **Local `.env` gotcha:** Next.js interpolates `$` in env values, which mangles the bcrypt `ADMIN_PASSWORD_HASH` (and any `$`-bearing secret). Escape each `$` as `\$` in local `.env`/`.env.local` files. Vercel injects vars literally — use the **unescaped** hash there. Also avoid `set -a; source .env` in the terminal running `npm run dev` (it exports mangled values that override the file).

---

## 8. Build, test, migrate
- `npm run typecheck` · `npm test` (vitest; routing, offer window, IDX, and SMS/Telnyx unit suites) · `npm run build`.
- `npm run db:migrate` applies journalled SQL migrations; `npm run seed` seeds launch cities.
- Verified at build time (Scoring v4 session): typecheck clean, build compiles, **155 tests pass across 17 files** (up from 141 — the refinements-v1 baseline — with `tests/leadLifecycle.test.ts`, the v4 point-table / fast-engagement / worked-example cases in `tests/v16.test.ts`, and the v4 SMS vocabulary).

---

## 9. Known gaps / follow-ups (deliberate)
- **MAX_LEADS routing gate / capacity cap** — decided against by the owner; do **not** build. Agents keep receiving offers regardless of active-lead count.
- **Google reviews need a dedicated server key.** `GOOGLE_MAPS_API_KEY` must be an unrestricted (no HTTP-referrer) key with the **legacy Places API + Geocoding API** enabled; the public `NEXT_PUBLIC_` key is referrer-locked and Google rejects it for server-side calls (`REQUEST_DENIED`). Same key powers office/agent geocoding. Errors now surface on the office card.
- **Still not built:** daily cron to auto-refresh Google reviews (fetch is manual via Admin → Testimonials); a tier above "Top Performer"; the operator config from the prior session (per-office Place IDs, location→office links, homepage review source, `BLOB_READ_WRITE_TOKEN`).
- Excluded by owner decision: BoldTrail/CRM sync, AI chat, S3 photo upload, client-side instant calculator, per-agent capacity caps, "resend offer", "recommend agent" preview, nearest-locations, testimonials carousel, standalone `/faq`.
- **SMS — built, agent-facing, Telnyx-only** (§4.7): replaces the prior dormant Twilio stub. No-ops safely until `TELNYX_API_KEY`/`TELNYX_PUBLIC_KEY`/`offices.telnyx_number` are set — see the Telnyx follow-ups below.
- Legal pages carry real copy dated Feb 19, 2026 — have counsel review before launch.
- The Drizzle snapshot chain is SQL-only; keep authoring migrations by hand (see §3) rather than `drizzle-kit generate`. Apply the full 0006–**0016** chain **in order on every Neon branch**.

### IDX follow-ups (pre-launch)
- **Run the backfills:** GitHub Actions `IDX Initial Sync` — `active` (now a two-pass job: feed-wide **primary-photo-only** pass + Active/UC **full-gallery** pass) + `sold` year-by-year. **Resumable + resilient:** each job orders by `ModificationTimestamp` and checkpoints (`idx_backfill_checkpoints`, migration 0020) so a failed/cancelled run resumes; the fetch layer retries transient network/5xx errors and re-mints the token on every 401; job timeout is 350 min. `--restart` forces a full pull. Hourly incremental (`idx-sync.yml`) keeps it current. **StandardStatus filter constants are space-less enum member names** (`ActiveUnderContract`, not `Active Under Contract`).
- **Scheduled cron jobs** run entirely from GitHub Actions now (`cron.yml` every ~10 min; `scheduled-daily.yml` for the daily/weekly jobs). `vercel.json` has **no** crons (Hobby caps at 2, and Vercel Cron can't send `x-cron-secret`). Needs the `DEPLOY_URL` + `CRON_SECRET` repo secrets set correctly (a 404 there = wrong `DEPLOY_URL`/undeployed app, not auth).
- **Cloud env:** set all `REALCOMP_*` in **Vercel** + **GitHub Actions secrets** (unescaped hash in Vercel; `REALCOMP_BASE_URL=idxapi`, `REALCOMP_AUDIENCE=rcapi`).
- **Realcomp-approved logo** now in place at `public/assets/realcomp-logo.png` (was committed with a wrong filename/aspect ratio; fixed). Rendered adjacent to summary cards and in the listing-detail credit (§18.3.4/§18.3.5).
- **Market-report narrative** uses `ANTHROPIC_API_KEY`; **property records** need the ATTOM `property/expandedprofile` endpoint on the plan; **Explore-Your-Market** tiles read blob URLs from `lib/cityImages.ts` (fill these in); the **footer** closest-office logic needs office coordinates set.
- **Reconcile `REALCOMP_OFFICE_KEYS`** to only RE/MAX Platinum OfficeMlsIds — the feed's `Office` collection also lists unrelated "Platinum" brokerages (KW Platinum, RC Platinum Inc).
- **Not built (deferred):** IDX-based AVM (spec §7), buyer-facing IDX search, member/office entity sync, co-mingling other MLS feeds.

### Telnyx follow-ups (pre-launch)
- **Provision 4 numbers (one per office) and complete 10DLC/toll-free carrier registration before go-live** — unregistered US SMS is throttled/blocked by carriers regardless of a valid API key. See `SETUP.md` §7 for the full walkthrough.
- **Set `TELNYX_API_KEY`/`TELNYX_PUBLIC_KEY` in both Vercel (app) and anywhere the crons run**, and populate `offices.telnyx_number` per office — same "set it in every environment that reads it" trap as `REALCOMP_OFFICE_KEYS` (lessons §15).
- **Point the Telnyx portal's inbound webhook at `https://<domain>/api/webhooks/telnyx`** and confirm the Messaging Profile's public key matches `TELNYX_PUBLIC_KEY` — a mismatch fails closed (every inbound text silently 401s) rather than accepting an unverified message.
- **Live send/receive is untested** — no Telnyx credentials exist in the build sandbox. All logic is unit-tested pure functions (parsing, templates, signature verification, number resolution) plus typecheck/build; a live text round-trip is the owner's first-connection step, same pattern as the IDX feed's `idx:verify`.
