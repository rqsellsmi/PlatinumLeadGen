# Feature Inventory Audit — Original Manus System vs. Current New Build

**Prepared:** 2026-06-30
**Branch:** `leadgenv1.6`
**Original system (Manus):** `rqsellsmi/remax-seller-landing-page` — Vite/React (SSR) + Express + tRPC v11 + Drizzle ORM on **TiDB Cloud (MySQL-wire)**. App version checkpoint `605363c7`. Hosted on the Manus platform (uses Manus "Forge" APIs for LLM, image gen, voice, maps, storage, owner notifications).
**New build:** `rqsellsmi/platinumleadgen` (`/home/user/PlatinumLeadGen`) — Next.js 14 App Router + Drizzle ORM on **Neon Postgres**, NextAuth v5, MS Graph email. Package `remax-lead-platform` v1.2.0.

This document is the full detail behind the gap analysis. It is organized into:
- **Part 1** — Original system, exhaustive feature inventory (what exists, every formula/column/trigger).
- **Part 2** — New build, exhaustive feature inventory.
- **Part 3** — Gap report: every original feature marked ✅ Built / ⚠️ Partial / ❌ Missing, with the original behavior, the new-build equivalent, and the original source files.
- **Part 4** — Net-new features in the new build (not in the original).

Legend: **✅ Built** = exists and works the same way. **⚠️ Partial** = exists but incomplete or behaves differently. **❌ Missing** = in original, absent from new build.

---

# PART 1 — ORIGINAL MANUS SYSTEM (exhaustive)

## 1.1 Architecture & stack
- **Server:** Express + tRPC v11 mounted at `/api/trpc`. Real entry `server/_core/index.ts` (NOT `server/index.ts`, which is vestigial). SSR for `/`, `/faq`, `/privacy`, `/terms`, `/location/*`; CSR for admin/agent/offer.
- **Background jobs:** in-process `setInterval`, started at server boot via `startFollowupScheduler()`; **15-minute** tick. `autoReassign.ts` scheduler exists but is **NOT started in prod** (superseded by followupScheduler).
- **DB:** Drizzle (mysql dialect) on TiDB Cloud. `relations.ts` empty — all FKs by convention (`*Id`), not enforced. 25 tables.
- **Rate limiting:** express-rate-limit — lead submit 20/15min; valuation 30/hr (skipped in dev).
- **Auth:** Manus OAuth + HS256 JWT cookie (1-yr) for `users`; admin-password token (`base64("admin:"+ADMIN_PASSWORD)`, `x-admin-token` header) for the dashboard; agent magic-link (64-hex, 30-day) for the portal.
- **Email:** MS Graph (preferred, if `MS_GRAPH_*` set) else Gmail SMTP (nodemailer).

## 1.2 Lead intake & data model
- **Unified `leads` table** — valuation/PDF/hero all live here, discriminated by `leadTypeId` (1=Valuation, 2=PDF, 3=Hero/Home Valuation, 4=Seller Guide). Legacy `pdfDownloadLeads`/`heroLeads` tables were consolidated out.
- **Partial lead capture:** `submitPartialLead({address, ...attribution, sessionId})` fires on Google-Places address-select (before contact info). Creates a row with `partialStatus="partial"`, `partialStep="address_entered"`, `leadScore=1`, email/phone null. (`server/routers/landingPage.ts`)
- **Full submission:** `submitValuationLead` (always `leadTypeId=3`, `leadScore=9`) and `submitPdfDownloadLead` (`leadTypeId=2`). Email is the only required field.
- **Lead quality scoring (leadScore column):** +1 address entered, +3 contact info, +2 return visit, +5 completed form (proven by tests; "12-point" spec). Routing gate evolved to "email present = agent-ready."
- **Dedup (3 layers):**
  - `findExistingLeadByContact(phone,email)` — normalized phone digits OR lowercased email → returns existing, notifies its assigned agent (or owner), logs `duplicate_submission` event, returns existing leadId (no new row).
  - `findLeadByAddress(address)` — `normalizeAddress()` (trim+lowercase+suffix map), most-recent non-deleted match → cross-session merge.
  - Partial→full merge by `sessionId`.
- **Address normalization** (`server/addressNormalization.ts`): lowercase, strip usa/punctuation, suffix abbreviation map (street→st, avenue→ave, etc.), used as dedup key.
- **`leadEvents` table + timeline:** every lead action logged — `address_entered`, `valuation_submitted`, `pdf_downloaded`, `duplicate_submission`, `appointment_requested`. (`drizzle/0018`, `landingPage.ts`)
- **Attribution captured on every lead:** utmSource/Medium/Campaign/Content/Term, gclid, gbraid, wbraid, landingPageUrl, pageUrl, referrer, deviceType, sessionId, firstSeenAt, lastSeenAt. First-touch + latest-touch persisted client-side (`client/src/lib/attribution.ts`).
- **Soft delete** (`softDeleteLead`): sets `isDeleted=1`, cancels open offers (status→declined "Lead deleted by admin"), and **reverses all negative non-negated agentScoreLog entries** for those offers (`isNegated=1`, applies reverse delta). Emails each affected agent ("no penalty applied"). (`server/db.ts`)
- **Admin "create test lead"** (`admin.createTestLead`): hardcoded Brighton valuation $285k–$335k (no RentCast), dedup on test emails, fires autoOffer + homeowner email (test → redirected to rqsellsmi@gmail.com). (`server/routers.ts`)

## 1.3 Valuation (RentCast AVM)
- `valuation.getEstimate` (`server/routers/valuation.ts`, `server/rentcast.ts`): GET `https://api.rentcast.io/v1/avm/value`, header `X-Api-Key`, **compCount=5**.
- Logs every call to `apiUsageLogs` (success/fail, responseTimeMs, address, est value, range).
- **Monthly quota alert:** counts rentcast calls this calendar month; when count `=== 40` exactly (80% of assumed 50/mo free tier) → `notifyOwner`.
- **Range widening:** `RANGE_PCT=0.20` — `low=round(price*0.80/1000)*1000`, `high=round(price*1.20/1000)*1000` (nearest $1,000). Wider than RentCast's native ±12%.
- Returns property details (formattedAddress, beds/baths/sqft/yearBuilt/lat/lng/lastSale…) + up to 5 comparables. **No local fallback** if RentCast fails.
- **Client-side `InstantValuationCalculator.tsx`:** local estimate (no backend) from beds/baths/sqft/condition — basePricePerSqft = avgSalePrice/1800, bed/bath/condition multipliers, ±10% range.

## 1.4 Agent routing engine (`server/routers/agents.ts`)
- **`recommendAgents(leadLat, leadLng, topN, excluded)`** — weighted proximity-first round-robin.
- **Slot weighting `slotCountForScore`:** 0–19→1, 20–39→2, 40–59→3 (default 50→3), 60–79→4, 80–99→5, 100–119→6, **≥120→7 (cap)**.
- **`buildRotationList`** — interleaves each agent's slots round-robin (not bunched).
- **Distance:** haversine to the agent's **office** coordinates only (R=6371 km in routing; R=3958.8 mi in `db.haversineDistanceMiles`). `PROXIMITY_RADIUS_KM=32.2` (20 mi). `MAX_LEADS=20` (agents at ≥20 active leads skipped).
- **3-pass selection:** (1) proximity within 32.2km from queue pointer; (2) office-fallback (nearest offices); (3) global-fallback (any eligible). Persisted queue (`agentQueue` row: rotationList JSON + pointer + lastRebuilt) with bypass-aware pointer logic. Rebuilds when roster changes.

## 1.5 Offer lifecycle (`server/autoOffer.ts`, `agents.ts`)
- **`autoOfferLead(leadId, leadType, origin)`** fires immediately after lead creation (fire-and-forget). Picks next agent via `recommendAgents`; no agent → `notifyOwner` "Needs Manual Assignment."
- **Token:** `crypto.randomBytes(32)` → **64-hex**; URL valid **7 days**. Accept/decline URLs `${origin}/offer/${token}?response=accept|decline`.
- **Offer window 7am–8pm ET** (`server/offerWindow.ts`, America/Detroit, DST-aware). In-window → send now; out-of-window → leave `offerSentAt` NULL (queued) + notifyOwner "Queued for Morning Offer." Scheduler dispatches at next 7am (restart-safe; no setTimeout).
- **Acceptance deadline = offerSentAt + 3 hours** (`getOfferDeadline`).
- **Teaser→reveal:** offer email shows initials + city only; full contact revealed only on accept.
- **respondToOffer** (public): on accept sets 48h first-update deadline, supersedes sibling offers, lead→accepted, sends `buildLeadAcceptedEmail`. On decline applies −3 and reassigns.
- **reassignLead** excludes explicit decliners (`getDeclinedAgentIdsForLead`; timed-out agents CAN be re-offered).
- **Admin offer tools:** `offerLeadToAgent`, `resendOffer` (declines old, new token, resend), `removeLeadOffer` (reverses score penalties; accepted offers cannot be removed).

## 1.6 Agent scoring / gamification (`server/db.ts`, `agents.ts`, `landingPage.ts`)
- `agents.agentScore` FLOAT default **50**, **clamped [0,200]**, 2-dp. Immutable `agentScoreLog` audit (delta, scoreAfter, eventType, reason, triggeredBy, leadOfferId, isNegated, negatedReason).
- **Accept reward by response speed (minutes from offerSentAt):** `<15`→**+10**, `15–30`→**+7.65**, `30–60`→**+5**, `≥60`→**+2** (null sentAt treated as <15).
- **Decline:** **−3.00** + reassign.
- **No-response (offer expiry, live):** **−1.50** (`system_no_response`). (Legacy autoReassign.ts uses −5.00, not run in prod.)
- **Stale penalties:** **−1.00 at 48h** (no status update), then **−1.00 every 7 days** recurring.
- **Pipeline bonuses:** closed **+15**, contacted **+2** (+3 if accepted <24h ago), qualified **+2** (+2 if it skipped contacted). (`applyLeadStatusBonuses`)
- **Admin manual adjustment** (`manual_adjustment`, requires reason). **Reversal/negation** on lead/offer delete.
- Per-agent stats: `getAllAgentOfferStats` — total/accepted/declined/expired/pending, `acceptRate = round(accepted/(accepted+declined+expired)*100)`.

## 1.7 Follow-up scheduler & background jobs (`server/followupScheduler.ts`)
Every 15 min, in order:
1. **checkQueuedOffers** — dispatch window-queued offers when 7am–8pm ET opens (set offerSentAt + 3h deadline).
2. **checkExpiredOffers** — `tokenExpiresAt <= now` → decline "Auto-expired", −1.50, reassign.
3. **checkEscalations** — accepted offer, no first update within 48h → red "Lead Follow-up Overdue" email to **broker**.
4. **checkWeeklyReminders** — `nextReminderDue <= now` → "Weekly Update Needed" email to **agent** (with portal link), push +7d.
5. **checkThursdayDigest** — Thursday 8:00–8:30am ET → HTML digest of all active accepted leads to broker (⚠️ flags overdue ≥2 days). Deduped per ISO date.
6. **checkStaleWarnings** — 36h mark → "12 hours until penalty" to agent.
7. **checkStale6DayWarnings** — 6-day mark → "24 hours until penalty" to agent.
8. **checkStale48hPenalties** — −1.00 (`stale_48h`).
9. **checkStale7DayPenalties** — −1.00 recurring (`stale_7day`).

## 1.8 Emails (`server/email.ts`, `msGraphEmail.ts`) — every distinct email
1. **Homeowner confirmation** (`buildHomeownerConfirmationEmail`) — on lead submit; subject varies by type; test→rqsellsmi@gmail.com.
2. **Agent lead offer** (`buildLeadOfferEmail`) — name redacted to initials, accept/decline links, optional portal link.
3. **Lead accepted** (`buildLeadAcceptedEmail`) — full contact reveal, to broker.
4. **Owner/broker push** (`notifyOwner`, Manus API not SMTP) — new lead / partial lead / "needs manual assignment."
5. **Lead deleted notice** (`buildLeadDeletedNotificationEmail`) — to affected agent, "no penalty applied."
6. **Broker escalation** (48h).
7. **Weekly agent reminder** (day 7, with portal link).
8. **Thursday broker digest.**
9. **Stale-lead warning** (36h / 6-day, to agent).
10. **RentCast usage alert** (40 calls, to owner).

## 1.9 CRM — BoldTrail / kvCORE (`server/boldtrail.ts`)
- `submitLeadToBoldTrail` → POST `https://api.kvcore.com/v2/public/contact`, Bearer `BOLDTRAIL_API_TOKEN`. Fields: `first_name`, `last_name`, `email`, `cell_phone_1` (digits→int), `source`, `deal_type` (default "seller"), `primary_address`, `assigned_agent_id` (String, only if set), `notes` (timeframe/est value/range/"MANUAL VALUATION NEEDED"). Sync status stored on `leadOffers.boldtrailSyncStatus/boldtrailSyncedAt`. Agents carry `boldtrailUserId`.
- `testBoldTrailConnection`. (Note: removed from the live submit path per tests, but the integration + per-agent BoldTrail ID + sync-status columns exist; admin UI has a hidden CRM sync column.)

## 1.10 CSV closings import & metrics (`server/routers/csvUpload.ts`, `metricsUpdate.ts`)
- **One CSV type = closings export**, tagged `agentRole` ∈ {listing, buyer} by the caller.
- **`uploadClosings`** — accepted header aliases → `closings` columns:
  - `closeDate` ← Close Date / CloseDate / Closing Date / Date Closed (multi-format parse)
  - `listPrice` ← List Price / ListPrice / Original Price / Original List Price ($,comma strip)
  - `salePrice` ← Sale Price / SalePrice / Sold Price / Close Price
  - `daysOnMarket` ← Days on Market / DOM / CDOM / Days On Market / DaysOnMarket
  - `address` ← Address / Property Address / Street Address
  - `city` ← City; `state` ← State (default MI); `zipCode` ← Zip/ZIP/Zip Code/Postal Code
  - `propertyType` ← Property Type / Type (default "Single Family")
  - `agentName` ← Agent / Agent Name / Listing Agent / Buyer Agent
  - `mlsNumber` ← MLS / MLS # / MLS Number (dedup key)
  - `schoolDistrict` ← School District / District / School
  - `percentOfListPrice` ← RATIO Close Price By List Price / % of List Price / Sale to List Ratio… (if 0<v≤5 ×100)
  - **Dedup by `mlsNumber` per agentRole**; per-row error capture; writes `uploadBatches` (rowsImported/Skipped/Errored, earliest/latest closeDate); links closings via `uploadBatchId`.
- Batch history: `getUploadHistory`, `getClosingsByBatch`, `deleteBatch`, `deleteAllClosings`.
- **`getClosingStats` / `getClosingStatsBySchoolDistrict`** — avgDaysOnMarket, avgSalePrice, avgPercentOfList, listing/buyer split.
- **`metricsUpdate.updateAllMetrics`** — recomputes from closings:
  - **Homepage (`homePageMetrics`):** totalHomesSold (all), pctAboveListPrice (all), then averages over **2025 window `[2025-01-01,2026-01-01)`** with all-time fallback: homesSold, avgSalePrice, avgDaysToSell (dom>0), avgPercentOfList (pct>0). All `Math.round`.
  - **Per-location (`marketStats`)** by matching `closings.schoolDistrict = location.schoolDistrict`: same formulas; skip districts with 0 closings.
  - **Recent-sales auto-population (diff-based):** top-3 listing-side by closeDate per district → insert/update/delete auto rows by `closingId`; **never touches `imageUrl`**; preserves manual rows.
- No median / absorption-rate / list-to-sale-ratio beyond `percentOfList` averaging.
- **Property photo upload** (`server/routers/photoUpload.ts`): base64 → S3 via `storagePut`, `propertyPhotos` table.

## 1.11 Admin console (client `pages/`, `components/admin/`)
- `/admin` — **Location content CMS** (password gate). Sidebar locations list + tabbed editor: Overview, Market Stats (read-only), Recent Sales (+ photo upload), Testimonials, Neighborhoods, Leads. Forms: LocationForm, RecentSaleForm, TestimonialForm, NeighborhoodLinkForm, TrackingScriptForm, read-only MarketStatsForm/HomePageMetricsForm.
- `/admin/leads` — unified **LeadsTable** (Partial/Full/All tabs, filters, edit dialog with Lead Details / Assign & Status / Offer History tabs; **Recommend Agent** → weighted picks with Offer Lead/Assign Only; Resend Offer; soft-delete). **NotificationPhoneCard** — `leadNotificationPhone` setting for **SMS** new-lead alerts.
- `/admin/agents` — **AdminAgents**: agent + office CRUD, agent-score slider (0–200) + BoldTrail User ID, accept-rate column, Score History dialog (+ manual adjustment), Offer History dialog (+ remove/restore score), **QueuePreviewWidget**.
- `/admin/queue` — **AdminQueueVisualizer**: @dnd-kit drag-to-reorder the **fully expanded rotation** (each slot a row), insert/remove agent, Save/Discard.
- `/admin/data-upload` — **DataUpload**: listing/buyer CSV upload, Update Metrics, Clear All, batch history (expandable to closings).
- `/admin/metrics` — **Metrics**: hardcoded 2025 performance display.
- `/admin/api-usage` — **ApiUsage**: RentCast monitoring (4 stat cards, free-tier 50/mo bar, daily chart, recent calls + errors).
- **VersionBadge** (changelog tooltip). AdminNav top bar.

## 1.12 Agent-facing pages
- `/offer/:token` — **OfferResponse**: accept/decline (auto-accept on `?response=accept`); contact masked until accept; decline reason select; "reassigned" state if auto-expired.
- `/agent/leads` — **AgentPortal** (magic link): greeting, overdue banner, **ScorePanel** (score + tier + recent score events), **LeadCard** per accepted lead with status-update buttons (left_voicemail/spoke_with_lead/appointment_set/lead_went_cold/other), update history, custom lead order. RequestLinkForm for magic link.

## 1.13 Public / landing pages
- `/` — **SellersGuide** (real homepage): hero + AddressValuationTool, live home metrics, PDF download modal (gated, fires Seller Guide conversion), market grid, JSON-LD RealEstateAgent+FAQPage.
- `/location/:slug` — **LocationLanding**: UrgencyBanner, AddressValuationTool, recent sales, **TestimonialsCarousel** (auto-advance 8s), **"Nearby Areas We Serve"** (`getNearestLocations`, haversine), per-office hardcoded address/hours/map, JSON-LD LocalBusiness+RealEstateAgent+BreadcrumbList.
- `/thank-you` — appointment request form (preferredTime, notes), fires Appointment conversion.
- `/faq` (12 items + FAQPage JSON-LD), `/privacy`, `/terms` (legal), `/404`.
- **AddressValuationTool** — primary capture: Google Places autocomplete (SE-Michigan biased) + manual fallback; partial-lead on select; RentCast estimate; fires `fireSellerValuationConversion` on save; GA4 funnel events.
- **AIChatBox** — markdown chat UI (Streamdown), wired for a tRPC ai.chat mutation (LLM).

## 1.14 Attribution & Google Ads conversions (`client/src/lib/`)
- **Attribution** (`attribution.ts`): first-touch + latest-touch in localStorage, sessionId in sessionStorage, UTM + gclid/gbraid/wbraid capture, device/referrer; spread into every lead payload. SSR-safe.
- **Google Ads** (`googleAdsConversions.ts`, account **AW-17043745770**): **4 conversion actions** fired via `gtag("event","conversion")` ONLY after confirmed backend save, deduped via lead-ID `transaction_id`, with **enhanced conversions** (hashed email/phone/name in `gtag("set","user_data")`):
  - Seller Valuation Lead — $100 — `.../P13JCP6ArqUcEOrXi78_`
  - Hero Seller Lead — $75 — `.../CJ-HCIGBrqUcEOrXi78_`
  - Seller Guide Download — $20 — `.../-EGYCJKDrqUcEOrXi78_`
  - Appointment Request — $150 — `.../YLtCCJWDrqUcEOrXi78_`
- `useGtagConversion` fires a generic conversion on mount. PPC plan + Google Ads Editor import in `docs/`.

## 1.15 Manus Forge platform capabilities (`server/_core/`)
- **LLM** (`llm.ts`) — Gemini 2.5 Flash via Forge proxy, max_tokens 32768 (powers AIChatBox).
- **Image generation** (`imageGeneration.ts`) — generate → S3.
- **Voice transcription** (`voiceTranscription.ts`) — Whisper, 16MB.
- **Google Maps proxy** (`map.ts`) — geocode/places/etc.
- **Owner notifications** (`notification.ts`) — `notifyOwner` push via Manus.
- **Storage** (`storage.ts`) — S3-style put/get.
- **Generic Data API** (`dataApi.ts`).

## 1.16 Scripts (`/`, `scripts/`)
`rebuild_queue.js` (divergent slot formula), `run-migration-016..019.mjs`, `run-update-lead-types.mjs`, `get_portal_token.cjs`, `insertTestLead.*`, `migrate-0022.mjs` (firstUpdateSubmittedAt), `negate-deleted-lead-scores.mjs`, `rebuildQueue.ts`.

---

# PART 2 — NEW BUILD (exhaustive, what works today)

## 2.1 Architecture & stack
- Next.js 14 App Router; route handlers `runtime=nodejs`, `dynamic=force-dynamic`. Server actions for admin (all call `requireAdmin()`).
- **DB:** Neon Postgres via `drizzle-orm/neon-http` (lazy client). **22 tables.** No `users`/`config` tables.
- **Background jobs:** external cron — **GitHub Actions every 10 min** pings 3 endpoints + **Vercel cron** daily backups. All cron routes gated by `x-cron-secret == CRON_SECRET`.
- **Auth:** Admin = NextAuth v5 credentials (env-only `ADMIN_USERNAME` + bcrypt `ADMIN_PASSWORD_HASH`, **no user table**). Agent = magic link (64-hex, 30-day) + email/password (bcrypt) + signed HMAC session cookie (7-day, edge-verified in middleware). Webhooks = API key (`rpk_` bcrypt). Rate limiting = Neon fixed-window (fail-open).
- **Email:** Microsoft Graph only (OAuth client-credentials, token persisted in `ms_graph_tokens`, every send logged to `email_send_log`). **No Gmail fallback.**

## 2.2 Lead intake & data model
- **Unified `leads` table** (lead_type enum: valuation/seller_guide/webhook; status: new/contacted/qualified/closed/lost). `page_variant` ('seo'|'ads'), `source`, `socialProofCount` on locations.
- **`/api/leads/partial`** — upsert by `sessionId` (no email, no routing).
- **`/api/leads/submit`** — rate-limited; email required; RentCast fill-in if coords missing; upsert by sessionId; increments location `socialProofCount`; `autoOfferLead`; homeowner confirmation email.
- **`/api/valuation`** — RentCast; logs `api_usage_logs`.
- **`/api/appointments`** — appointment_requests + admin email (same-origin enforced).
- **Webhooks** — `/api/webhooks/lead`, `/api/webhooks/appointment` (API-key auth).
- **Soft delete** — `softDeleteLead` sets `isDeleted=true` (no score reversal).
- Validation in `lib/validation.ts` (shared by routes + webhooks).

## 2.3 Valuation
- `lib/rentcast.ts` `getValuation(address)` — `/avm/value`, `X-Api-Key`. 404→all-null. Fallback range = **estimate×0.92 / ×1.08**. Throws on non-404. Used by `/api/valuation` and `/api/leads/submit`.

## 2.4 Routing engine (`lib/routing.ts`, `lib/autoOffer.ts`, `lib/offerWindow.ts`, `lib/scoring.ts`)
- `haversine` R=3958.8 mi. **`slotCountForScore = max(1, min(5, 1+floor(score/15)))`** (cap 5). `buildRotationList` repeats each id by slot count (sorted by id asc).
- `recommendAgents` — proximity-first: build rotation over eligible, walk from `queuePointer`, pick first in proximity pool (≤ radius, default 20mi) else global fallback; returns new pointer + distance. (The "Dearborn bug" fix.)
- `autoOfferLead` — 64-hex token, 7-day TTL, 3-hour acceptance, offer window check; queued if outside window; persists queuePointer to `notification_settings`.
- `dispatchOfferEmail` — refreshes magic link, sends `agentLeadOfferEmail`, sets offerSentAt/firstUpdateDue(+48h)/nextReminderDue(+7d).
- `reassignLead` (excludes all prior agents), `manualReassignLead` (admin override; closes outstanding as `closed_manual`, inserts accepted offer, no penalty).
- **Scoring `SCORE_DELTAS`:** response_fast +7.5, good +5, slow +2, **no_response −1.5, decline −1.0**, closing +15, contacted +2, fast_contact +3, qualified +2, manual = variable. `applyScore` inserts log + `UPDATE agents SET score = score + delta` (**no clamp, no negation/reversal**).
- Accept response-time bands (`/api/offer/[token]`): **≤30min +7.5, ≤1h +5, ≤3h +2** (3 bands).

## 2.5 Offer lifecycle & cron
- `/api/offer/[token]?response=accept|decline` — accept (response-time score, auto-login cookie, redirect to portal) / decline (−1.0, reassign). Idempotent.
- **Cron:** `dispatch-queued-offers` (window-gated), `expire-offers` (cutoff now−3h → expired, −1.5, reassign), `followup-check` (48h escalation email to admin + weekly reminder, +7d), `broker-digest` (Thursday, to admin), `cleanup-rate-limits` (24h).

## 2.6 Agent scoring
- `agent_score_log` (delta, reason enum, note, leadId, leadOfferId). Pipeline scoring on status-update: contacted +2 (+3 fast within 24h), qualified +2, closed +15. Manual adjustment (admin, requires note). **No [0,200] clamp; no stale penalties; no negation on delete.**

## 2.7 Emails (MS Graph, `lib/email.ts`)
Templates: `agentLeadOfferEmail`, `agentAcceptanceEmail` (+ manual-assignment variant), `homeownerConfirmationEmail`, `escalationEmail` (admin), `weeklyReminderEmail`, `brokerDigestEmail` (admin), `appointmentNotificationEmail` (admin), `adminAlertEmail` (unrouted lead). All logged to `email_send_log`. **SMS = TODO v2 (absent).**

## 2.8 CSV / metrics
- Per-location **sales CSV import** (`locations/[id]/sales` action `importSalesCsv`): parses `address,soldPrice,daysOnMarket,closeDate,photoUrl`, bulk inserts `recent_sales`. **No dedup, no batches, no closings table, no metrics recompute.**
- Market stats are **manually entered** per location (`saveStats`). `home_page_metrics` single row, manually/seed-populated.

## 2.9 Admin console (`app/admin/*`)
Nav: Overview, Leads, Round-Robin, Agents, Offices, Locations (SEO/Stats/Sales/Testimonials sub-editors), Analytics, Email Log, API Keys, Settings.
- **Overview** — 5 KPIs, hot leads, leads-by-city bars, round-robin status.
- **Leads** — filter/paginate table; **leads/new** manual entry; **leads/[id]** detail (status, re-route, soft-delete, OfferHistory + reassign picker).
- **Round-Robin** — read-only rotation/next-up/weekly distribution.
- **Agents** — list + add; **agents/[id]** edit/set-password/adjust-score/deactivate/score-log.
- **Offices** — full CRUD. **Locations** — list + 4 sub-editors (SEO meta + FAQ builder; Stats; Sales + CSV; Testimonials).
- **Analytics** — SEO-vs-ADS conversion, CPL calculator, source breakdown, agent response.
- **Email Log** — MS Graph send log. **API Keys** — generate/revoke webhook keys. **Settings** — notification email, offer-window hours, proximity radius.

## 2.10 Agent portal (`app/agent/*`)
- Login (password OR magic-link auto-login). `/agent/leads` — **accepted leads only**, KPIs, "new to contact" alert, status filter tabs, drag-to-reorder. `/agent/leads/[leadOfferId]` — contact/property + status update + history. **AvailabilityToggle** (pause/resume routing — net-new). **No in-portal accept/decline UI** (email links only).

## 2.11 Public / landing pages
- `/` home, `/sell` city index, `/sell/[slug]` SEO money page (ISR, JSON-LD, dynamic OG image), `/ads/[slug]` PPC (noindex), `/thank-you`.
- `ValuationForm` — 2-step, Places autocomplete, partial→full, RentCast range bar.
- City components: HeroSection, SocialProofBar, MarketStatsBar, RecentSales, HowItWorks, SellerGuideSection (gated), Testimonials (grid), FaqSection, NeighborhoodLinks, TrackingScripts.
- CRO: ExitIntentOverlay, StickyCtaBar (net-new).
- Analytics: GTM + Microsoft Clarity (public only); dataLayer funnel events.

---

# PART 3 — GAP REPORT (every original feature)

## 3.1 Lead intake & capture

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Unified leads table (valuation/pdf/hero/guide via leadTypeId) | ✅ Built | New uses lead_type enum (valuation/seller_guide/webhook). Type taxonomy differs (no distinct PDF/hero type; PDF flow gone). | `drizzle/schema.ts`, `server/db.ts` |
| Partial lead capture on address-select | ✅ Built | `/api/leads/partial` upsert by sessionId. | `server/routers/landingPage.ts` (`submitPartialLead`) |
| Full lead submit (email-only required) | ✅ Built | `/api/leads/submit`, email required. | `landingPage.ts` (`submitValuationLead`) |
| **Lead quality score** (`leadScore`: +1 addr, +3 contact, +2 return, +5 complete) | ❌ Missing | New build has **no lead-quality score** at all (`leads` has no leadScore column). Only agent scoring exists. | `landingPage.ts`, `drizzle/schema.ts` (`leads.leadScore`) |
| **Contact dedup** (phone/email → return existing, notify its agent, log duplicate) | ❌ Missing | New build upserts by `sessionId` only. Two submissions with same email/phone but different sessions create two leads. No duplicate notification. | `server/db.ts` (`findExistingLeadByContact`), `landingPage.ts` |
| **Cross-session address dedup** (`normalizeAddress` + `findLeadByAddress`) | ❌ Missing | `lib/addressNormalization.ts` exists but is **not imported by any route**. No address-based dedup/merge. | `server/addressNormalization.ts`, `server/db.ts` (`findLeadByAddress`) |
| Partial→full merge by sessionId | ✅ Built | Upsert-by-sessionId covers this. | `landingPage.ts` |
| **Lead event timeline** (`leadEvents`: address_entered, valuation_submitted, pdf_downloaded, duplicate_submission, appointment_requested) | ❌ Missing | No `lead_events` table. `status_updates` only logs agent status changes, not the funnel/lead activity timeline. | `drizzle/0018`, `landingPage.ts`, `server/db.ts` (`createLeadEvent`) |
| Attribution capture (UTM/gclid/gbraid/wbraid/referrer/device/session/first+last seen) on lead | ❌ Missing | New `leads` table stores none of these columns; only `page_variant` + `source`. Attribution is not persisted server-side. | `client/src/lib/attribution.ts`, `landingPage.ts`, `drizzle/0018` |
| Attribution on appointment requests | ❌ Missing | `appointment_requests` has no attribution columns. | `drizzle/0019` |
| Soft-delete lead | ⚠️ Partial | Built (`isDeleted=true`) **but does NOT reverse agent score penalties** and does not email affected agents. | `server/db.ts` (`softDeleteLead`), `landingPage.ts` |
| Admin "create test lead" (hardcoded Brighton, no RentCast, test-email redirect) | ⚠️ Partial | `createManualLead` exists for real offline leads (routes normally); no dedicated hardcoded test-lead path / test-email redirect. | `server/routers.ts` (`createTestLead`) |
| PDF download lead flow + gated guide download | ⚠️ Partial | New has `SellerGuideSection` (seller_guide lead + guideUrl) but no PDF modal, no distinct backend PDF flow, no Seller Guide conversion. | `landingPage.ts` (`submitPdfDownloadLead`), `client/.../PdfDownloadModal.tsx` |

## 3.2 Valuation

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| RentCast AVM valuation | ✅ Built | `lib/rentcast.ts`. | `server/rentcast.ts`, `server/routers/valuation.ts` |
| Range widening **±20%** rounded to $1,000 | ⚠️ Partial | New uses **±8% fallback** (×0.92/×1.08) and otherwise RentCast's own range — narrower, different formula. | `server/routers/valuation.ts` (`RANGE_PCT=0.20`) |
| Comparables returned (up to 5) | ❌ Missing | New `getValuation` returns only estimate + range + lat/lng; no comparables surfaced. | `server/rentcast.ts`, `valuation.ts` |
| API usage logging | ✅ Built | `api_usage_logs` (lighter schema: endpoint/ip/status). | `drizzle/0004-0005`, `valuation.ts` |
| **RentCast monthly quota alert at 40/50** | ❌ Missing | No call-count/quota alerting. | `valuation.ts` |
| **Client-side InstantValuationCalculator** (beds/baths/sqft/condition) | ❌ Missing | No client-side estimator; only RentCast. | `client/src/components/InstantValuationCalculator.tsx` |

## 3.3 Agent routing engine

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Proximity-first weighted round-robin | ✅ Built | `lib/routing.ts` `recommendAgents`. | `server/routers/agents.ts` |
| **Slot weighting formula** | ⚠️ Partial | Original: 7 bands by score/20, **cap 7** (≥120). New: `max(1,min(5,1+floor(score/15)))`, **cap 5**. Different distribution. | `server/routers/agents.ts` (`slotCountForScore`) |
| Distance to **office** coords (fallback agent coords) | ✅ Built | New uses agent coords else office coords (effective coords). | `agents.ts`, `autoOffer.ts` (`getActiveRoutingAgents`) |
| Proximity radius 20 mi (32.2 km) | ✅ Built | Default 20 mi, admin-configurable in Settings. | `agents.ts` (`PROXIMITY_RADIUS_KM`) |
| **MAX_LEADS=20 cap** (skip overloaded agents) | ❌ Missing | No active-lead cap in routing; busy agents still receive offers. | `agents.ts` (`MAX_LEADS`) |
| 3-pass selection (proximity → office-fallback → global) | ⚠️ Partial | New does proximity → global fallback (2 tiers); no explicit nearest-office tier. | `agents.ts` (`recommendAgents`) |
| **Persisted rotation list + bypass-aware pointer** (`agentQueue` row) | ⚠️ Partial | New stores only an integer `queue_pointer` in notification_settings; rotation list rebuilt on the fly each call. No persisted ordering or bypass pointer logic. | `server/db.ts` (agentQueue helpers), `agents.ts` |
| Decline-aware reassign (re-offer to timed-out, exclude explicit decliners) | ⚠️ Partial | New `reassignLead` excludes **all** prior agents (incl. timed-out), so a timed-out agent is never re-offered. | `server/autoOffer.ts` (`reassignLead`), `db.ts` (`getDeclinedAgentIdsForLead`) |
| Nearest-locations lookup (haversine, public) | ❌ Missing | No "Nearby Areas We Serve" on city pages. | `server/db.ts` (`getNearestLocations`), `landingPage.ts` |

## 3.4 Offer lifecycle

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Auto-offer on lead creation | ✅ Built | `autoOfferLead`. | `server/autoOffer.ts` |
| 64-hex token, 7-day URL expiry | ✅ Built | Same. | `autoOffer.ts`, `agents.ts` |
| 3-hour acceptance deadline | ✅ Built | Same. | `server/offerWindow.ts` |
| 7am–8pm ET offer window + queue-for-morning | ✅ Built | Same (admin-configurable hours). | `offerWindow.ts`, `followupScheduler.ts` |
| Teaser → full-contact reveal on accept | ✅ Built | Email-link flow; portal shows accepted contact. | `agents.ts`, `email.ts` |
| Supersede sibling offers on accept | ✅ Built (implied) | New closes prior offers on manual reassign; accept supersede behavior via single-offer model. | `db.ts` (`supersedeOtherOffersForLead`) |
| Auto-expire + reassign (−1.5) | ✅ Built | `expire-offers` cron. | `followupScheduler.ts`, `autoReassign.ts` |
| **Admin "Resend Offer email"** (same lead, new token) | ❌ Missing | New has reassign (next agent) but no resend-to-same-agent. | `agents.ts` (`resendOffer`) |
| **Admin "Remove offer & restore score"** | ❌ Missing | No offer-removal-with-score-reversal. | `agents.ts` (`removeLeadOffer`), `db.ts` |
| Manual admin assignment / override | ✅ Built | `manualReassignLead` (no penalty, full-contact email). | `db.ts` (`upsertManualLeadOffer`), `agents.ts` |

## 3.5 Agent scoring / gamification

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Agent score + immutable audit log | ✅ Built | `agent_score_log`. | `server/db.ts` (`applyScoreDelta`) |
| Score start 50 | ⚠️ Partial | New default score = **0** (`agents.score` default 0); seed/agents start at 0 not 50. | `drizzle/schema.ts` (`agents.agentScore` default 50) |
| **Score clamp [0,200]** | ❌ Missing | New `applyScore` does raw `score + delta`, no clamp. | `db.ts` (`applyScoreDelta`) |
| Accept reward bands | ⚠️ Partial | Original 4 bands (<15:**+10**, 15-30:**+7.65**, 30-60:+5, ≥60:+2). New 3 bands (≤30:**+7.5**, ≤1h:+5, ≤3h:+2). Top reward & 15-min tier differ. | `agents.ts` (`respondToOffer`) |
| Decline penalty | ⚠️ Partial | Original **−3.00**; new **−1.0**. | `agents.ts` |
| No-response penalty −1.5 | ✅ Built | Same. | `followupScheduler.ts` |
| **Stale penalties (−1 at 48h, −1 every 7d)** | ❌ Missing | Cron does 48h **escalation email** + weekly **reminder email** but **applies no score penalty**. `leads.stale_warning_sent_at`/`last_penalty_at` columns exist but are unused. | `followupScheduler.ts` (checkStale48h/7Day) |
| **Stale warnings (36h, 6-day "X hours to penalty")** | ❌ Missing | No pre-penalty warning emails to agent. | `followupScheduler.ts` |
| Pipeline bonuses (closed +15, contacted +2/+3 fast, qualified +2) | ✅ Built | `/api/agent/status-update`. | `landingPage.ts` (`applyLeadStatusBonuses`) |
| Manual admin score adjustment (requires reason) | ✅ Built | `adjustScore`. | `agents.ts` (`manualScoreAdjustment`) |
| **Score negation/reversal on lead/offer delete** | ❌ Missing | Soft-delete doesn't reverse penalties; no `isNegated` concept. | `db.ts` (`softDeleteLead`, `removeLeadOffer`) |
| Per-agent accept-rate stats | ✅ Built | `analytics.agentResponseMetrics` (accepted count + avg accept time; not full accept-rate %). | `db.ts` (`getAllAgentOfferStats`) |

## 3.6 Background jobs & scheduler

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Scheduler mechanism | ✅ Built | Original in-process 15-min setInterval; new external cron (GitHub Actions 10-min + Vercel daily). Different but functionally equivalent / better for serverless. | `server/followupScheduler.ts`, `_core/index.ts` |
| Queued-offer dispatch at window open | ✅ Built | `dispatch-queued-offers` cron. | `followupScheduler.ts` |
| Expire offers + reassign | ✅ Built | `expire-offers` cron. | `followupScheduler.ts` |
| 48h broker escalation | ✅ Built | `followup-check` cron → admin. | `followupScheduler.ts` |
| Weekly agent reminder | ✅ Built | `followup-check` cron. | `followupScheduler.ts` |
| Thursday broker digest | ✅ Built | `broker-digest` cron (Thu). | `followupScheduler.ts` |
| Stale warnings + penalties (36h/48h/6d/7d) | ❌ Missing | Not implemented (see 3.5). | `followupScheduler.ts` |
| RentCast usage alert job | ❌ Missing | Not implemented. | `valuation.ts` |
| Cleanup (new) | ✅ Built (net-new) | `cleanup-rate-limits` — no original equivalent. | — |

## 3.7 Emails & notifications

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Homeowner confirmation | ✅ Built | `homeownerConfirmationEmail`. | `email.ts` |
| Agent lead offer (initials teaser) | ✅ Built | `agentLeadOfferEmail`. | `email.ts` |
| Lead accepted (full contact) | ✅ Built | `agentAcceptanceEmail`. | `email.ts` |
| Lead deleted notice to agent | ❌ Missing | No email on soft-delete. | `email.ts` (`buildLeadDeletedNotificationEmail`) |
| Broker escalation (48h) | ✅ Built | `escalationEmail`. | `followupScheduler.ts` |
| Weekly agent reminder | ✅ Built | `weeklyReminderEmail`. | `followupScheduler.ts` |
| Thursday broker digest | ✅ Built | `brokerDigestEmail`. | `followupScheduler.ts` |
| Stale-lead warning emails | ❌ Missing | Not implemented. | `followupScheduler.ts` |
| RentCast usage alert email | ❌ Missing | Not implemented. | `valuation.ts` |
| **Owner push notifications** (`notifyOwner` via Manus, new/partial/manual-assignment) | ⚠️ Partial | New sends `adminAlertEmail` for unrouted leads only; no per-new-lead or partial-lead owner push. | `server/_core/notification.ts`, `autoOffer.ts`, `landingPage.ts` |
| **SMS lead alerts** (`leadNotificationPhone` setting) | ❌ Missing | Email-only; SMS is "TODO v2" in `lib/email.ts`. No notification phone setting. | `landingPage.ts`, `client/.../AdminLeads.tsx` (NotificationPhoneCard) |
| Dual provider (MS Graph + Gmail SMTP fallback) | ⚠️ Partial | New is MS Graph only (no fallback). | `email.ts`, `msGraphEmail.ts` |
| Email send logging | ✅ Built (net-new persistence) | `email_send_log` + admin Email Log screen. | — |

## 3.8 CRM integration

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| **BoldTrail / kvCORE lead push** (`/contact`, deal_type seller, assigned_agent_id, notes) | ❌ Missing | **No CRM integration anywhere** in the new build. No BoldTrail references. | `server/boldtrail.ts` |
| Per-agent BoldTrail User ID | ❌ Missing | No `boldtrailUserId` on agents. | `drizzle/schema.ts` (`agents.boldtrailUserId`) |
| BoldTrail sync status on offers | ❌ Missing | No sync-status columns. | `drizzle/schema.ts` (`leadOffers.boldtrailSyncStatus`) |
| BoldTrail connection test | ❌ Missing | — | `boldtrail.ts` (`testBoldTrailConnection`) |

## 3.9 CSV closings import & metrics

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| **Closings CSV importer** (listing/buyer, ~13 column aliases, $/comma strip, multi-date parse) | ⚠️ Partial | New imports **recent_sales only** with a fixed 5-column format (`address,soldPrice,daysOnMarket,closeDate,photoUrl`) per location. No listing/buyer roles, no listPrice/MLS/schoolDistrict/percentOfList, no header-alias matching. | `server/routers/csvUpload.ts` |
| **MLS dedup per agentRole** | ❌ Missing | No dedup on sales import. | `csvUpload.ts` (`uploadClosings`) |
| **Upload batch tracking** (`uploadBatches`, rows imported/skipped/errored, date range, batch history, delete batch) | ❌ Missing | No batch tracking; no `uploadBatches`/`closings` tables; no batch history UI. | `csvUpload.ts`, `drizzle/0016` |
| **`closings` table** (transaction store) | ❌ Missing | New has no closings table — only `recent_sales` showcase rows. | `drizzle/0008`, `schema.ts` |
| **Closing stats** (avg DOM/sale/percentOfList, by school district) | ❌ Missing | No closings analytics. | `csvUpload.ts` (`getClosingStats*`) |
| **`metricsUpdate.updateAllMetrics`** (recompute homepage + per-location stats from closings; 2025 window; % above list; pct-of-list) | ❌ Missing | Market stats and home-page metrics are **entered manually** per location; no recompute-from-data pipeline. | `server/routers/metricsUpdate.ts` |
| **Per-location stats by school district** | ❌ Missing | Locations have no schoolDistrict mapping; stats are manual. | `metricsUpdate.ts`, `schema.ts` (`locations.schoolDistrict`) |
| **Auto-populate recent sales from closings** (diff-based top-3 listing, preserve imageUrl/manual rows) | ❌ Missing | Recent sales are fully manual (form + simple CSV). | `metricsUpdate.ts` (`pickRecentSales`) |
| **Property photo upload to S3** | ❌ Missing | Photos are URL-paste only (`photo_url`); no upload/storage. | `server/routers/photoUpload.ts`, `server/storage.ts` |

## 3.10 Admin console

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Admin auth gate | ⚠️ Partial | Original = shared password token (open if unset). New = NextAuth credentials (username + bcrypt hash). Different/stronger. | `_core/trpc.ts`, `client/.../Admin.tsx` |
| Location content CMS (locations CRUD) | ✅ Built | `/admin/locations` + sub-editors. | `client/.../Admin.tsx`, `LocationForm.tsx` |
| Market stats editor | ⚠️ Partial | Original = **read-only** (derived from CSV). New = **manual entry** form. Inverted source-of-truth. | `MarketStatsForm.tsx`, `metricsUpdate.ts` |
| Recent sales CRUD (+ photo upload) | ⚠️ Partial | New has CRUD + URL photo + simple CSV, but no photo upload/S3 and no auto-population. | `RecentSaleForm.tsx`, `photoUpload.ts` |
| Testimonials CRUD | ✅ Built | + `isFeatured`. | `TestimonialForm.tsx` |
| Neighborhood links CRUD | ✅ Built | Sub-editor. | `NeighborhoodLinkForm.tsx` |
| **Per-location tracking scripts CRUD (head/body)** | ⚠️ Partial | New renders `tracking_scripts` (admin-managed, global or per-location) but there is **no admin CRUD screen/form** for them in scope (TrackingScripts component renders only). | `client/.../TrackingScriptForm.tsx`, `drizzle/0003` |
| SEO editor (meta + FAQ builder) | ✅ Built (net-new vs original) | `/admin/locations/[id]/seo` (original had no per-location SEO editor — SEO was code-level). | — |
| Unified leads table (Partial/Full/All tabs, filters) | ⚠️ Partial | New `/admin/leads` has filters + pagination but **no Partial/Full tabs**, no agent-update column, no inline recommend/offer. | `client/.../LeadsTable.tsx` |
| Lead edit dialog (details / assign+status / offer history) | ✅ Built | `/admin/leads/[id]` detail (status, reassign, soft-delete, OfferHistory). | `LeadsTable.tsx`, `OfferHistoryPanel` |
| **"Recommend Agent" in lead UI** (weighted picks + Offer/Assign) | ❌ Missing | Reassign picks next agent automatically; admin can't preview ranked recommendations and choose. | `LeadsTable.tsx`, `agents.recommendAgents` |
| Agent + office CRUD | ✅ Built | `/admin/agents`, `/admin/offices`. | `AdminAgents.tsx` |
| Agent score history + manual adjustment | ✅ Built | `/admin/agents/[id]`. | `AdminAgents.tsx` |
| Agent offer history + remove/restore | ⚠️ Partial | Offer history shown on lead detail; no per-agent offer-history dialog with remove/restore. | `AdminAgents.tsx` |
| **Queue visualizer (drag-reorder expanded rotation, insert/remove slots)** | ⚠️ Partial | New `/admin/round-robin` is **read-only** (no reorder/insert/remove/weight controls). | `client/.../AdminQueueVisualizer.tsx`, `agents.ts` |
| **Data Upload screen** (CSV + Update Metrics + Clear + batch history) | ❌ Missing | No closings upload screen; sales CSV is per-location only. | `client/.../DataUpload.tsx` |
| **Metrics screen** | ⚠️ Partial | Original was a static display; new Analytics screen is richer but different. | `client/.../Metrics.tsx` |
| **API Usage screen** (RentCast monitoring, free-tier bar, daily chart) | ❌ Missing | `api_usage_logs` is written but there is no admin dashboard for it. | `client/.../ApiUsage.tsx`, `apiUsage.ts` |
| Notification phone (SMS) card | ❌ Missing | Settings has notification **email** only. | `client/.../AdminLeads.tsx` |
| Version badge / changelog | ❌ Missing | No version/changelog UI. | `AdminNav.tsx`, `shared/version.ts` |
| **Appointment requests admin review screen** | ❌ Missing (both) | Original also lacked a dedicated screen (owner-notified only); new also has none. Parity at "missing." | `appointmentRequests` |

## 3.11 Agent portal

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Magic-link auth | ✅ Built | + email/password (net-new). | `server/agentPortalAuth.ts` |
| Accepted-leads dashboard | ✅ Built | `/agent/leads`. | `client/.../AgentPortal.tsx` |
| Status updates (5 statuses + note, first-within-48h, history) | ⚠️ Partial | New uses pipeline statuses (new/contacted/qualified/closed/lost) not the original vocabulary (left_voicemail/spoke_with_lead/appointment_set/lead_went_cold/other). Behavior similar; taxonomy differs. | `agents.ts` (`submitLeadStatusUpdate`) |
| Custom lead ordering (drag) | ✅ Built | `/api/agent/reorder`. | `agentLeadOrder` |
| **ScorePanel** (score + tier + recent score events) | ❌ Missing | Agent cannot see their score/tier or score-event history in the portal. | `client/.../AgentPortal.tsx` (ScorePanel) |
| Overdue-update banner / urgency indicators | ⚠️ Partial | New has "new leads to contact" alert but not the 48h/weekly overdue urgency badges. | `AgentPortal.tsx` |
| `/offer/:token` accept/decline page | ✅ Built | `/api/offer/[token]` (API route, auto-accept, decline reasons handled server-side). | `client/.../OfferResponse.tsx` |
| In-portal pending-offer accept/decline UI | ❌ Missing (both) | Original handled accept/decline on the token page, not in-portal either; new same. Parity. | — |

## 3.12 Public / landing pages

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Homepage with valuation tool + live metrics | ✅ Built | `/` (different layout). | `client/.../SellersGuide.tsx` |
| Per-city landing pages | ✅ Built | `/sell/[slug]` (ISR, richer SEO + OG image). | `client/.../LocationLanding.tsx` |
| Address valuation tool (Places autocomplete + manual fallback + partial lead) | ✅ Built | `ValuationForm` (2-step). | `client/.../AddressValuationTool.tsx` |
| **AI chat box** (LLM-powered) | ❌ Missing | No chat UI, no LLM. | `client/.../AIChatBox.tsx`, `server/_core/llm.ts` |
| **Testimonials carousel** (auto-advance) | ⚠️ Partial | New `Testimonials` is a static grid, not a carousel. | `client/.../TestimonialsCarousel.tsx` |
| **Urgency banner** | ⚠️ Partial | New `MarketStatsBar`/`SocialProofBar` cover similar stats but not the urgency framing. | `client/.../UrgencyBanner.tsx` |
| PDF download modal (gated guide) | ⚠️ Partial | `SellerGuideSection` gated form instead of modal. | `client/.../PdfDownloadModal.tsx` |
| **"Nearby Areas We Serve"** | ❌ Missing | No nearest-locations footer. | `LocationLanding.tsx`, `db.getNearestLocations` |
| Thank-you + appointment request | ✅ Built | `/thank-you` + AppointmentForm. | `client/.../ThankYou.tsx` |
| FAQ page (+ FAQPage JSON-LD) | ⚠️ Partial | FAQs are per-location (FaqSection) not a standalone `/faq` page. | `client/.../FAQ.tsx` |
| **Privacy / Terms pages** | ❌ Missing | No `/privacy` or `/terms`; `/ads` footer links to `/privacy` (dead link). | `client/.../PrivacyPolicy.tsx`, `TermsOfService.tsx` |
| Dynamic sitemap + robots | ✅ Built | `app/sitemap.ts`, `app/robots.ts`. | `_core/index.ts` |
| JSON-LD structured data | ✅ Built | `lib/seo.ts` (LocalBusiness/FAQPage). | `PageSEO.tsx` |
| Per-location injected tracking scripts | ✅ Built | `TrackingScripts` component. | `drizzle/0003`, `TrackingScriptForm.tsx` |

## 3.13 Attribution & conversion tracking

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| First-touch + latest-touch attribution (localStorage) | ❌ Missing | Not present client-side; attribution not captured/persisted. | `client/src/lib/attribution.ts` |
| UTM/gclid/gbraid/wbraid capture into lead payload | ❌ Missing | Lead payloads carry only sessionId + pageVariant + locationSlug. | `attribution.ts`, `landingPage.ts` |
| **Google Ads conversions (4 actions, $ values, transaction_id dedup, enhanced conversions)** | ❌ Missing | New fires only generic GTM `dataLayer` events (e.g. `lead_conversion` value 50) — no `gtag` conversion actions, no per-action send_to IDs, no enhanced-conversion user data, no lead-ID dedup. | `client/src/lib/googleAdsConversions.ts`, `hooks/useGtagConversion.ts` |
| GA4 funnel events | ⚠️ Partial | New pushes dataLayer events (address_entered, valuation_viewed, lead_conversion, appointment_requested, exit_intent_*). Original fired more granular GA4 events from the valuation tool. | `AddressValuationTool.tsx` |
| Microsoft Clarity | ✅ Built (net-new) | `components/Analytics.tsx`. | — |
| GTM injection | ✅ Built | `components/Analytics.tsx`. | `trackingScripts`/inline |

## 3.14 Auth & security

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| Admin auth | ⚠️ Partial | Password token → NextAuth credentials (no user table). | `_core/trpc.ts`, `_core/sdk.ts` |
| Agent magic-link auth | ✅ Built | + signed HMAC session cookie + password. | `agentPortalAuth.ts` |
| Manus OAuth + users table | ❌ Missing | New has no `users` table / no OAuth (admin is env-credential). | `_core/oauth.ts`, `_core/sdk.ts` |
| Rate limiting (lead/valuation) | ✅ Built | Neon fixed-window, more presets (login/offer/webhook). | `_core/index.ts` |
| Security headers (helmet) | ✅ Built | `next.config.js` strict CSP + headers (CSP enabled here; original disabled CSP). | `_core/index.ts` |
| **External webhook API keys** | ✅ Built (net-new) | `api_keys` + `/api/webhooks/*`. | — |

## 3.15 Manus Forge platform capabilities

| Original feature | Status | New build / detail | Original files |
|---|---|---|---|
| LLM (Gemini 2.5 Flash) | ❌ Missing | No LLM anywhere. | `server/_core/llm.ts` |
| Image generation | ❌ Missing | — | `server/_core/imageGeneration.ts` |
| Voice transcription (Whisper) | ❌ Missing | — | `server/_core/voiceTranscription.ts` |
| Google Maps proxy (server geocode) | ⚠️ Partial | New uses RentCast for geocoding + frontend Places via Google Maps API key; no server maps proxy. | `server/_core/map.ts` |
| Owner push notifications | ⚠️ Partial | Replaced by admin email alerts (limited cases). | `server/_core/notification.ts` |
| S3-style storage | ❌ Missing | No file storage (photos are URLs). | `server/storage.ts` |
| Generic Data API proxy | ❌ Missing | — | `server/_core/dataApi.ts` |

## 3.16 Database schema deltas
- **Removed in new build:** `users`, `config`, `closings`, `uploadBatches`, `propertyPhotos`, `leadEvents`, `leadTypes` (enum instead), `agentQueue` (now an int pointer), and all attribution/leadScore columns on `leads`; `boldtrail*` columns; `schoolDistrict` on locations.
- **Schema cols present-but-unused in new build:** `leads.stale_warning_sent_at`, `leads.last_penalty_at`, `agents.password_reset_token`, `ms_graph_tokens.refresh_token`.
- **Net-new tables in new build:** `rate_limits`, `ms_graph_tokens`, `email_send_log`, `api_keys`, `notification_settings` (replaces config), `agent_lead_order` (parity), `status_updates` (parity with leadStatusUpdates).

---

# PART 4 — NET-NEW IN THE NEW BUILD (not in original)

These are capabilities the new build adds beyond the original (useful context for the spec, not gaps):
- **PPC `/ads/[slug]` landing pages** (noindex) with dedicated Ads components and click-to-call.
- **CRO**: ExitIntentOverlay + StickyCtaBar.
- **`page_variant` (seo/ads)** tagging + **SEO-vs-ADS conversion analytics** + **CPL calculator**.
- **External webhook intake** (`/api/webhooks/lead`, `/api/webhooks/appointment`) with bcrypt API keys + admin key management.
- **Agent self-service availability toggle** (`isAvailable`) — pause/resume routing.
- **Agent email+password login** (in addition to magic link).
- **Email send log** persisted + admin Email Log screen.
- **Per-location SEO editor** (meta + dynamic FAQ builder) in admin.
- **Microsoft Clarity** session analytics.
- **Manual reassign as `closed_manual`** offer state with no penalty.
- **`socialProofCount`** auto-increment + SocialProofBar; Google review count/rating fields.
- **ISR** (incremental static regeneration) + on-demand `/api/revalidate`.
- **`cleanup-rate-limits`** maintenance cron.
- Serverless-friendly **external cron** (GitHub Actions + Vercel) instead of in-process timers.

---

# APPENDIX — High-priority rebuild targets (the biggest ❌ gaps)
1. **CSV closings pipeline + metrics recompute** (closings table, uploadBatches, MLS dedup, listing/buyer, `updateAllMetrics`, per-school-district stats, auto-populate recent sales, % above list). — `server/routers/csvUpload.ts`, `metricsUpdate.ts`, `drizzle/0008,0009,0010,0014,0016`
2. **BoldTrail / kvCORE CRM sync** (lead push on accept, per-agent BoldTrail ID, sync status). — `server/boldtrail.ts`
3. **Google Ads conversions + attribution** (4 conversion actions w/ values, enhanced conversions, gclid/UTM capture & persistence). — `client/src/lib/googleAdsConversions.ts`, `attribution.ts`
4. **Stale-lead penalty/warning engine** (36h/48h/6d/7d emails + score deltas + clamp + negation-on-delete). — `server/followupScheduler.ts`, `db.ts`
5. **Lead dedup** (contact + cross-session address) + **lead event timeline** + **lead quality score**. — `server/db.ts`, `landingPage.ts`, `addressNormalization.ts`
6. **Admin queue visualizer** (drag-reorder rotation, insert/remove) + persisted rotation list + bypass pointer. — `client/src/pages/AdminQueueVisualizer.tsx`, `server/routers/agents.ts`
7. **API Usage dashboard + RentCast quota alert**, **SMS lead alerts**, **owner push parity**, **property photo upload (S3)**.
8. **Public extras:** AI chat box (LLM), testimonials carousel, urgency banner, nearest-locations, privacy/terms pages, client-side instant calculator.
