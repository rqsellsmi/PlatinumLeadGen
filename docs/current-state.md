# RE/MAX Platinum Lead Platform — Current State

**Branch:** `claude/previous-session-items-q3l47m` (rebased from `leadgenv1.6`)
**Stack:** Next.js 14 (App Router) · TypeScript · Drizzle ORM · Neon Postgres · NextAuth v5 · Microsoft Graph email · RentCast AVM · **Realcomp IDX feed (RESO/OData)** · Tailwind
**Deploy target:** Vercel (serverless) + GitHub Actions cron
**As of:** the v1.6 addendum build + reviews/routing/**Scoring v2** + the **IDX feed integration** session + the **Listing/Valuation Fixes + IDX backfill hardening** session + the **Texting & Refinement** session (exit-intent autocomplete, wider hero field, redesigned sold-listing data-sheet page with a neighborhood-POI map; migrations `0006–0022`)

This document explains what the system is, what it does, and how it works, so anyone (human or AI) can orient quickly before testing or extending it.

---

## 1. What it is

A single Next.js application that does three jobs for a Southeast-Michigan real-estate brokerage:

1. **Generates seller leads** through SEO city landing pages and PPC ad pages that offer a free instant home valuation.
2. **Routes each lead to an agent** via a weighted, proximity-first round-robin with a timed offer/accept lifecycle and a gamified agent score.
3. **Gives the brokerage a back office** — an admin console (leads, agents, offices, locations/SEO/content, market-data import, analytics, API/email monitoring, routing queue) and an agent portal (accepted leads, status updates, availability, score).

It is a rebuild of an older Manus-hosted system. This build intentionally omits some legacy capabilities (BoldTrail CRM sync, AI chat, SMS, S3 photo upload, the Manus "Forge" platform features) — see `feature-inventory-audit-v1.6.md` for the full comparison and the addendum's explicit exclusions.

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
- **leads** — one row per homeowner. Partial (address only, keyed by `sessionId`) upgrades to complete on submit. Holds contact, property, valuation estimate/range, `pageVariant` (`seo`/`ads`), `source`, full attribution (UTM/gclid/gbraid/wbraid/referrer/device/first+lastSeen), `normalizedAddress` (dedup key), soft-delete, and the stale-clock fields `staleWarningSentAt`/`lastPenaltyAt`. Lifecycle v2 (spec v2 §4): `status` enum adds `reopened`; `contactedAt` (Lost precondition), `lostReason`/`lostAt`, `stallPenaltyAt` (30-day recurrence), `reopenedAt`.
- **lead_offers** — routing output. One row per offer to an agent; token (64-hex, 7-day), `offerSentAt` (null = queued), accepted/declined/expired/responded timestamps, `firstUpdateDue` (+48h), `nextReminderDue` (+7d), `distanceMiles`. Status enum includes `closed_manual` (admin override).
- **lead_events** — full lifecycle timeline (`address_entered`, `valuation_submitted`, `duplicate_submission`, `offer_sent/accepted/declined/expired`, `manually_assigned`, `status_updated`, `appointment_requested`).
- **status_updates** — agent pipeline updates per offer.
- **appointment_requests** — thank-you scheduling requests (+ attribution).

Agents & routing:
- **agents** — roster; **four score tracks** (`scoreLifetime`/`scoreYtd`/`scoreMonthly`/`scoreRolling365`, uncapped; `score` kept as a lifetime mirror), `isActive` (admin) + `isAvailable` (agent self-toggle), magic-link token, optional password hash. Per-agent proximity: `proximityAnchor` (`office`|`custom`), `locationCity` (geocoded → `latitude`/`longitude`), `proximityRadiusMiles` (null → global default).
- **offices** — routing anchors (agent coords fall back to office coords) **and** per-office Google Business Profile: `googlePlaceId`, cached `googleReviewRating`/`Count`/`FetchedAt`/`Error`.
- **agent_score_log** — immutable score audit; every delta with reason enum (adds `pipeline_stalled`), optional `isNegated`/`negatedReason` for deletion reversals. Source for the rolling-365 sum.
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

Migrations are hand-authored idempotent SQL in `drizzle/migrations/` and registered in `meta/_journal.json`. Current head is **`0022_area_poi_cache`** (Texting/Refinement session added **`0021_idx_buyer_fields`** — ~35 buyer-relevant RESO columns on `idx_listings`: HOA fee/frequency/includes/amenities, taxes, heating/cooling, fireplaces, laundry, interior/exterior features, appliances, flooring, construction, roof, foundation, parking, pool, patio, lot features, water source, sewer, utilities, style, levels/stories, rooms, view, zoning, new-construction; and **`0022_area_poi_cache`** — cached Google-Places neighborhood POIs keyed by a coarse coordinate grid cell). The Listing/Valuation-Fixes session added **`0017_idx_widen_urls`** (photo/tour/media URL columns → `text`), **`0018_property_records`** (cached AVM property records), **`0019_market_narratives`** (cached AI market-report copy), and **`0020_idx_backfill_checkpoints`** (resumable-backfill cursors); **`0016_idx_widen_text`** widens overflow-prone `idx_listings` text columns; **`0015_idx_integration`** added the IDX tables + leads report columns; the scoring/reviews/proximity work spans **0006–0014** (valuations `0006–0007`, google reviews `0008`, per-office reviews `0009–0010`, location→office `0011`, agent proximity `0012`, scoring v2 `0013`, rolling-365 rename `0014`). **Apply them in order on every DB** — several admin pages `select` the whole `agents`/`leads` row, so one skipped migration in the middle breaks those pages.

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
- **Proximity-first**: an agent joins the proximity pool when the lead is within *that agent's own* radius of *their* anchor (haversine). Scan the queue from the front and serve the first pool member; if none in range (or no lead coords), serve the front slot (global fallback).
- **No capacity cap** — by owner decision, an agent keeps receiving offers regardless of active-lead count (the `MAX_LEADS` gate is intentionally never built).
- **Offer window** 7am–8pm ET; outside the window the offer is created but `offerSentAt` stays null and the dispatch cron sends it at the next open.
- **Acceptance** deadline = send + 3h.

### 4.3 Agent score — Scoring v2 (`lib/scoring.ts`, uncapped; see `docs/agent-rating-system.md`)
Four tracks per agent, all written by `applyScore`: **lifetime** (never resets, tier label, private), **YTD** (Jan 1), **monthly** (1st), **rolling-365** (trailing-365d log sum, drives routing only). No clamp.

| Event | Delta | Event | Delta |
|---|---|---|---|
| Accept <15 min | +8 | Contacted | +2 (+3 if <24h) |
| Accept 15–30 min | +6 | Qualified | +2 |
| Accept 30–60 min | +4 | Closed | +25 |
| Accept 60m–3h | +1 | Stale 48h / 7-day | −2 / −2 |
| Decline | −3 | Stalled 30-day | −3 (recurs) |
| No response (expired) | −4 | Marked Lost | 0 |

Slots = `1 + floor(sqrt(max(rolling365,0)/10))` (uncapped, from rolling-365). Tiers are **cohort-relative percentiles** of active agents' lifetime score (top 10% Top Performer, then 70/50/30/10th down to At Risk; `lib/scoreTiers.ts`). Leaderboards at `/agent/leaderboard` (monthly + YTD, top 20 + your rank). Admin **Lost-reason roll-up** at `/admin/lost-reasons` (reason mix + per-agent unresponsive-rate signal).

**Lifecycle (spec v2 §4):** **Lost** needs a prior Contacted + a fixed reason (no score); **stall** (`pipeline_stalled`) hits Qualified leads idle 30d, recurring, until Closed/Lost; **reopen** flips a Lost lead whose contact submits again to **Reopened**, resets clocks, routes to the same active agent else fresh. `/api/cron/score-maintenance` (daily) decays rolling-365 and resets monthly/YTD at boundaries.

### 4.4 Stale follow-up (cron `followup-check`)
36h warning email → 48h penalty (−2) → 6-day warning → 7-day recurring penalty (−2) → 30-day Qualified stall (−3, recurring). The 6-day warning reuses `staleWarningSentAt` with the compound "warned-before-last-penalty" filter (§K.4). Also: 48h broker escalation, weekly agent reminder, Thursday broker digest.

### 4.5 Market data → stats (`lib/csvClosings.ts`, `lib/metrics.ts`)
CSV import maps ~13 header aliases, parses multi-format dates and `$`/comma money, dedups by MLS number per role, and records a batch. `updateAllMetrics` then recomputes homepage + per-location stats over the 2025 window (all-time fallback) and diff-populates the top-3 listing-side recent sales per district without overwriting photos or manual rows.

### 4.6b IDX feed (`lib/realcomp.ts`, `lib/idxSync.ts`, `lib/idx.ts`, `lib/idxMetrics.ts`)
- **Auth/fetch** (`lib/realcomp.ts`): OAuth client-credentials token persisted to Neon; `realcompFetch`/`realcompFetchPages` paginate via `@odata.nextLink`. Account-specific values (all env-overridable): host `idxapi.realcomp.com/odata`, token `auth.realcomp.com/Token`, **audience `rcapi.realcomp.com`**. **Self-healing auth:** the persisted token is reused until ~5 min pre-expiry, but a `401` triggers a one-time forced re-mint (`getValidRealcompToken(true)`) + retry, so a token cached during a transient misconfig (e.g. a blank audience) can't wedge the sync — env getters use `||` (not `??`) so an empty secret falls back to the default rather than overriding it.
- **Sync** (`lib/idxSync.ts`, `runIdxSync`): walks forward in **bounded 1-hour `ModificationTimestamp` windows** from a checkpoint (`idx_backfill_checkpoints` key `incremental`, seeded from the DB's max cursor). Per window: Query 2 = all Active/Pending/Closed feed-wide, upserted **page-by-page**; the checkpoint advances only after a window fully drains (gap-free resume, no `$orderby`). Query 1 = your offices, ALL statuses (per-field `*OfficeMlsId in (...)`, split under IIS's ~2KB URL limit), pulled once over the range advanced that run. An **open-ended `gt cursor` feed-wide query does NOT scale** — Realcomp materializes the whole result before page 1, so a multi-day delta hangs the first request past the 5-min timeout (lessons §16); windows keep every result set small. Live Q1/Q2 counts flush to `idx_sync_log` every ~10s. Defensive field mapping (`mapRealcompListing`): city from `OriginalPostalCity`, county humanized, `WaterfrontFeatures` enum→CSV, Media→photos. No stale deactivation.
  - **Where it runs:** the hourly job (`idx-sync.yml`) runs the sync **directly on the GitHub runner** (`npm run idx:sync:incremental` → `scripts/idx-incremental-sync.ts`, `budgetMs: Infinity`), NOT by pinging Vercel. The old design curled `/api/cron/idx-sync`, a Vercel function hard-capped at 60s, which a feed-wide delta can't finish → permanent 504 loop (see lessons §16). The `/api/cron/idx-sync` endpoint + admin **Run Now** (`runSyncNow`) still call the same `runIdxSync` but keep the 45s serverless budget (they mark a cut-short run `partial`). Initial backfill via manual GitHub Actions workflow (`scripts/idx-initial-sync.ts`).
- **Reads** (`lib/idx.ts`): `getSimilarHomes` (Active near subject), `getRecentSoldComps` (Closed ≤90d), `getCityMarketStats` (median DOM/price, sale-to-list, months of inventory), all with the IDX display gates baked in.
- **Metrics** (`lib/idxMetrics.ts`): `updateMetricsFromIdx()` recomputes `home_page_metrics` + `market_stats` from office-closed deals — guarded (no-op until backfilled), so it never zeros live stats.
- **Compliance** (`lib/idxDisclosures.ts`, `components/idx/*`): Realcomp logo + office credit on every card, all required disclaimers, no RE/MAX branding in listing bodies.

### 4.6 Conversion tracking (`lib/googleAdsConversions.ts`, `lib/attribution.ts`)
Four Google Ads conversions fire client-side after a confirmed save (Seller Valuation $100, Hero/PPC $75, Seller Guide $20, Appointment $150), with enhanced-conversion user data and transaction-id dedup (prefixed `hero-`/`appointment-`). Attribution is captured on every public page load and persisted on each lead. GA4/Clarity load via GTM on public pages only.

---

## 5. Surfaces

**Public:** `/`, `/sell`, `/sell/[slug]` (SEO money page, ISR, JSON-LD, dynamic OG image; now also a "Verified Google Reviews" section from the linked office), `/ads/[slug]` (PPC, noindex), **`/thank-you` — the "Full Valuation page"** (revealed estimate + confidence hero, condition refiner, then IDX Similar Homes For Sale / Recently Sold / Market Report; reached via the `reportToken` in the redirect + confirmation email; the Market Report is now the redesigned brokerage card with a YoY/12-month trend and an AI-written, dash-free summary), **`/listing/[listingKey]`** (IDX listing detail — redesigned "data sheet": photo hero with status/price overlay, dark stat bar, beds/baths/sqft/year row, feature chips, two-column Interior/Lot detail from the expanded feed, **Neighborhood Highlights** map + nearby-POI cards (restaurants/parks/coffee/etc., no schools, Google Places cached), a sold-only "How this home compared" block + full Market Report card, and a seller CTA; full gallery for Active + ActiveUnderContract, primary photo only for Pending/Closed per §18.10, office credit/logo/copyright; **noindex** unless `IDX_INDEX_LISTINGS=1`), `/privacy`, `/terms`. CRO: exit-intent overlay + sticky CTA. Homepage below-hero metrics + city Market-Stats bar now share one component/metric set; the site footer address resolves to the page's linked or closest office (default Brighton).

**Admin (`/admin/*`, NextAuth):** Overview · Leads · **Property Lookup** (enter any address → full AVM property record incl. owner, with a cache-busting refresh) · Round-Robin (drag-reorder) · **Lost Reasons** · Leads/new · Agents · Offices (+ Google Place ID & review status) · Locations · **IDX Sync** (status, counts, coverage, Run Now) · **IDX Listings** (read-only browser) · **Market Reports** (who opened their report) · Analytics · API Usage · Email Log · API Keys · Settings. (Data Upload + Recent Sales retired — see IDX feed.) The agent + admin **lead detail** pages now show the full "About this home" AVM record (owner of record, tax/assessment, building detail; no raw JSON, values title-cased).

**Agent (`/agent/*`, signed session cookie):** login · leads dashboard (KPIs, ScorePanel = lifetime + tier, filter tabs, drag reorder, availability toggle) · pipeline · performance · **leaderboard** (monthly + YTD, top 20 + your rank) · **settings** (proximity anchor: office or a geocoded city, + acceptance radius) · lead detail (contact, status update with Lost-reason picker, history).

**External:** `POST /api/webhooks/lead` and `/api/webhooks/appointment` (bcrypt API-key auth) for third-party lead sources.

---

## 6. Auth & security
- Admin = NextAuth credentials (env `ADMIN_USERNAME` + bcrypt `ADMIN_PASSWORD_HASH`, no user table).
- Agent = magic-link (64-hex, 30-day) or email+password, plus a signed HMAC session cookie (edge-verified in middleware).
- Webhooks = `rpk_` API keys (bcrypt-hashed). Cron = `x-cron-secret`. Revalidate = `x-revalidate-secret`.
- Rate limiting = Neon fixed-window per (ip, endpoint, window), fail-open. Strict CSP + security headers in `next.config.js`.

---

## 7. Environment variables
`DATABASE_URL` (or any Neon/Vercel alias) · `NEXTAUTH_SECRET` · `NEXTAUTH_URL` · `ADMIN_USERNAME` · `ADMIN_PASSWORD_HASH` · `MS_GRAPH_CLIENT_ID/SECRET/TENANT_ID/FROM_EMAIL/ADMIN_EMAIL` (or `MICROSOFT_*` aliases) · `RENTCAST_API_KEY` · `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` · `NEXT_PUBLIC_GTM_ID` · `NEXT_PUBLIC_CLARITY_PROJECT_ID` · `SITE_URL` · `CRON_SECRET` · `REVALIDATE_SECRET` · **IDX:** `REALCOMP_CLIENT_ID`/`_SECRET` · `REALCOMP_BASE_URL` (`https://idxapi.realcomp.com/odata`) · `REALCOMP_AUTH_URL` (`https://auth.realcomp.com/Token`) · `REALCOMP_AUDIENCE` (`rcapi.realcomp.com`) · `REALCOMP_OFFICE_KEYS` (comma list of **OfficeMlsId** values). **AVM/AI (Listing/Valuation-Fixes session):** `VALUATION_PROVIDER` (`attom`|`rentcast`, default rentcast — currently `attom`) · `ATTOM_API_KEY` (property records use ATTOM `property/expandedprofile`, which must be on the plan) · `ANTHROPIC_API_KEY` + optional `ANTHROPIC_MODEL` (market-report narrative; falls back to a written template without it) · `IDX_INDEX_LISTINGS=1` to let `/listing/[listingKey]` be indexed (noindex otherwise) · **`LISTING_AREA_POI`** (`0` disables the listing-page Neighborhood-Highlights POI section; default on when a Google server key is present — needs the **legacy Places API** + billing for Nearby Search, and the **Maps Embed API** for the embedded map) · `DEPLOY_URL` (GitHub Actions secret; the served app URL, currently `https://platinum-lead-gen.vercel.app`, no trailing slash).

> ⚠ **Local `.env` gotcha:** Next.js interpolates `$` in env values, which mangles the bcrypt `ADMIN_PASSWORD_HASH` (and any `$`-bearing secret). Escape each `$` as `\$` in local `.env`/`.env.local` files. Vercel injects vars literally — use the **unescaped** hash there. Also avoid `set -a; source .env` in the terminal running `npm run dev` (it exports mangled values that override the file).

---

## 8. Build, test, migrate
- `npm run typecheck` · `npm test` (vitest; routing, offer window, and v1.6 unit suites) · `npm run build`.
- `npm run db:migrate` applies journalled SQL migrations; `npm run seed` seeds launch cities.
- Verified at build time: typecheck clean, build compiles, 26 tests pass.

---

## 9. Known gaps / follow-ups (deliberate)
- **MAX_LEADS routing gate / capacity cap** — decided against by the owner; do **not** build. Agents keep receiving offers regardless of active-lead count.
- **Google reviews need a dedicated server key.** `GOOGLE_MAPS_API_KEY` must be an unrestricted (no HTTP-referrer) key with the **legacy Places API + Geocoding API** enabled; the public `NEXT_PUBLIC_` key is referrer-locked and Google rejects it for server-side calls (`REQUEST_DENIED`). Same key powers office/agent geocoding. Errors now surface on the office card.
- **Still not built:** daily cron to auto-refresh Google reviews (fetch is manual via Admin → Testimonials); a tier above "Top Performer"; the operator config from the prior session (per-office Place IDs, location→office links, homepage review source, `TWILIO_*`, `BLOB_READ_WRITE_TOKEN`).
- Excluded by owner decision: BoldTrail/CRM sync, AI chat, S3 photo upload, client-side instant calculator, per-agent capacity caps, "resend offer", "recommend agent" preview, nearest-locations, testimonials carousel, standalone `/faq`. (SMS is wired via `lib/sms.ts`, no-op until `TWILIO_*` set.)
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
