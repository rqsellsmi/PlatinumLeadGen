# RE/MAX Platinum Lead Platform — Current State

**Branch:** `leadgenv1.6`
**Stack:** Next.js 14 (App Router) · TypeScript · Drizzle ORM · Neon Postgres · NextAuth v5 · Microsoft Graph email · Tailwind
**Deploy target:** Vercel (serverless) + GitHub Actions cron
**As of:** the v1.6 addendum build (Sections A–J + K corrections)

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
- **leads** — one row per homeowner. Partial (address only, keyed by `sessionId`) upgrades to complete on submit. Holds contact, property, valuation estimate/range, `pageVariant` (`seo`/`ads`), `source`, full attribution (UTM/gclid/gbraid/wbraid/referrer/device/first+lastSeen), `normalizedAddress` (dedup key), soft-delete, and the stale-clock fields `staleWarningSentAt`/`lastPenaltyAt`.
- **lead_offers** — routing output. One row per offer to an agent; token (64-hex, 7-day), `offerSentAt` (null = queued), accepted/declined/expired/responded timestamps, `firstUpdateDue` (+48h), `nextReminderDue` (+7d), `distanceMiles`. Status enum includes `closed_manual` (admin override).
- **lead_events** — full lifecycle timeline (`address_entered`, `valuation_submitted`, `duplicate_submission`, `offer_sent/accepted/declined/expired`, `manually_assigned`, `status_updated`, `appointment_requested`).
- **status_updates** — agent pipeline updates per offer.
- **appointment_requests** — thank-you scheduling requests (+ attribution).

Agents & routing:
- **agents** — roster; `score` (real, default **50**, clamped [0,200]), `isActive` (admin) + `isAvailable` (agent self-toggle), magic-link token, optional password hash, coordinates.
- **offices** — locations used as routing anchors (agent coords fall back to office coords).
- **agent_score_log** — immutable score audit; every delta with reason enum, optional `isNegated`/`negatedReason` for deletion reversals.
- **agent_queue** — persisted weighted rotation (`rotationList` JSON of agent ids with slot duplicates + `pointer`). Source of truth for routing order; honors admin drag-reorder; auto-rebuilds when the routable-agent set changes.
- **agent_lead_order** — the agent's custom drag order of their accepted leads.

Content & marketing:
- **locations** — city pages: slug, SEO copy (`metaTitle/metaDescription/heroHeadline/heroSubheadline/faqJson/guideUrl`), `schoolDistrict` (matches closings → stats), `socialProofCount`, Google review fields.
- **market_stats** (per location) and **home_page_metrics** (single row) — recomputed from closings.
- **recent_sales** — showcase rows; manual or `isAutoPopulated` (linked to a `closingId`).
- **testimonials**, **neighborhood_links**, **tracking_scripts**.

Market data:
- **closings** — imported MLS transactions (listing/buyer role, list/sale price, DOM, school district, % of list, MLS number).
- **upload_batches** — one row per CSV import with counts and date range.

Ops/infra:
- **api_usage_logs** (RentCast calls, enriched with success/response-time/estimate), **rate_limits** (Neon fixed-window), **ms_graph_tokens** (persisted OAuth token), **email_send_log** (every send), **api_keys** (bcrypt-hashed webhook keys), **notification_settings** (single-row config: notification email, offer-window hours, proximity radius, queue pointer).

Migrations are hand-authored idempotent SQL in `drizzle/migrations/` and registered in `meta/_journal.json`; the v1.6 changes are `0003_v16_addendum.sql`.

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

### 4.3 Agent score (`lib/scoring.ts`) — all clamped to [0,200]
| Event | Delta |
|---|---|
| Accept < 15 min | +10 |
| Accept 15–30 min | +7.65 |
| Accept 30–60 min | +5 |
| Accept ≥ 60 min (or null sent time) | +2 |
| Decline | −3 |
| No response (offer expired at 3h) | −1.5 |
| No first update by 48h | −1 |
| Recurring weekly no-update | −1 |
| Reached Contacted | +2 (+3 if within 24h of accept) |
| Reached Qualified | +2 |
| Closed | +15 |
| Admin manual adjust | variable (reason required) |
| Lead deleted | reverses the negative entries tied to the cancelled open offers |

Tiers (agent portal): ≥100 Top Performer · ≥80 Strong · ≥60 Good Standing · ≥40 Average · ≥20 Needs Improvement · <20 At Risk.

### 4.4 Stale follow-up (cron `followup-check`)
36h warning email → 48h penalty (−1) → 6-day warning → 7-day recurring penalty (−1). The 6-day warning reuses `staleWarningSentAt` with the compound "warned-before-last-penalty" filter (§K.4). Also: 48h broker escalation, weekly agent reminder, Thursday broker digest.

### 4.5 Market data → stats (`lib/csvClosings.ts`, `lib/metrics.ts`)
CSV import maps ~13 header aliases, parses multi-format dates and `$`/comma money, dedups by MLS number per role, and records a batch. `updateAllMetrics` then recomputes homepage + per-location stats over the 2025 window (all-time fallback) and diff-populates the top-3 listing-side recent sales per district without overwriting photos or manual rows.

### 4.6 Conversion tracking (`lib/googleAdsConversions.ts`, `lib/attribution.ts`)
Four Google Ads conversions fire client-side after a confirmed save (Seller Valuation $100, Hero/PPC $75, Seller Guide $20, Appointment $150), with enhanced-conversion user data and transaction-id dedup (prefixed `hero-`/`appointment-`). Attribution is captured on every public page load and persisted on each lead. GA4/Clarity load via GTM on public pages only.

---

## 5. Surfaces

**Public:** `/`, `/sell`, `/sell/[slug]` (SEO money page, ISR, JSON-LD, dynamic OG image), `/ads/[slug]` (PPC, noindex), `/thank-you`, `/privacy`, `/terms`. CRO: exit-intent overlay + sticky CTA.

**Admin (`/admin/*`, NextAuth):** Overview · Leads (list + detail with offer history, attribution, activity timeline, reassign, soft-delete) · Leads/new · Round-Robin (interactive drag-reorder) · Agents (+ detail: password, manual score, score log) · Offices · Locations (+ SEO/Stats/Sales/Testimonials editors, school-district field) · Data Upload · Analytics (SEO-vs-ADS, CPL, UTM sources, agent response) · API Usage · Email Log · API Keys · Settings.

**Agent (`/agent/*`, signed session cookie):** login (password or magic link) · leads dashboard (KPIs, ScorePanel, filter tabs, drag reorder, availability toggle) · lead detail (contact, status update, history).

**External:** `POST /api/webhooks/lead` and `/api/webhooks/appointment` (bcrypt API-key auth) for third-party lead sources.

---

## 6. Auth & security
- Admin = NextAuth credentials (env `ADMIN_USERNAME` + bcrypt `ADMIN_PASSWORD_HASH`, no user table).
- Agent = magic-link (64-hex, 30-day) or email+password, plus a signed HMAC session cookie (edge-verified in middleware).
- Webhooks = `rpk_` API keys (bcrypt-hashed). Cron = `x-cron-secret`. Revalidate = `x-revalidate-secret`.
- Rate limiting = Neon fixed-window per (ip, endpoint, window), fail-open. Strict CSP + security headers in `next.config.js`.

---

## 7. Environment variables
`DATABASE_URL` (or any Neon/Vercel alias) · `NEXTAUTH_SECRET` · `NEXTAUTH_URL` · `ADMIN_USERNAME` · `ADMIN_PASSWORD_HASH` · `MS_GRAPH_CLIENT_ID/SECRET/TENANT_ID/FROM_EMAIL/ADMIN_EMAIL` (or `MICROSOFT_*` aliases) · `RENTCAST_API_KEY` · `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` · `NEXT_PUBLIC_GTM_ID` · `NEXT_PUBLIC_CLARITY_PROJECT_ID` · `SITE_URL` · `CRON_SECRET` · `REVALIDATE_SECRET`.

---

## 8. Build, test, migrate
- `npm run typecheck` · `npm test` (vitest; routing, offer window, and v1.6 unit suites) · `npm run build`.
- `npm run db:migrate` applies journalled SQL migrations; `npm run seed` seeds launch cities.
- Verified at build time: typecheck clean, build compiles, 26 tests pass.

---

## 9. Known gaps / follow-ups (deliberate)
- **MAX_LEADS routing gate / capacity cap** — decided against by the owner; do **not** build. Agents keep receiving offers regardless of active-lead count.
- Excluded by owner decision: BoldTrail/CRM sync, AI chat, SMS alerts, S3 photo upload, client-side instant calculator, lead-quality score, per-agent capacity caps, "resend offer", "recommend agent" preview, nearest-locations, testimonials carousel, standalone `/faq`.
- Legal pages carry real copy dated Feb 19, 2026 — have counsel review before launch.
- The Drizzle snapshot chain is SQL-only; keep authoring migrations by hand (see §3) rather than `drizzle-kit generate`.
