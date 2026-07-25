# Buyer Side — Home Search + Buyer-Lead Pipeline — Design Spec

**Date:** 2026-07-25
**Status:** Draft design — pending sign-off
**Branch:** `feature/buyer-search` (from `refinements-v1`)
**Author:** Requirement-gathering session (superpowers workflow)
**Related:** `docs/current-state.md`, `docs/lessons-learned.md`, the IDX read layer
(`lib/idx.ts`), Scoring v4 (`docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md`)

---

## 1. Summary

Turn the site into a two-sided platform. Today it is a **seller** lead machine
(valuation funnel → routing → Scoring v4). This adds the **buyer** side: a public
home-search experience over the existing Realcomp IDX mirror (`idx_listings`), and
a **buyer lead** pipeline that reuses the entire seller routing/offer/scoring
machinery — activated by the already-existing-but-inert `leads.intent` field.

Five surfaces change or get built:

1. **Homepage (`/`) → buyer-first.** A search hero (location search default + a
   "What's my home worth" tab that launches the existing valuation flow), 9 recent
   active listings, and 12 city tiles. The current seller homepage moves **intact**
   to `/sell/home-value`.
2. **Home search (`/homes`, new).** Filter by price / beds / baths / location
   (current-location, city autocomplete, **draw-an-area on a map**) + a full
   advanced-filter set. **Interactive Google Maps JS + Drawing** with a multi-pin
   results map.
3. **Listing detail (`/listing/[listingKey]`, enhance in place).** Key-feature icon
   chips under bed/bath/sqft, a photo **carousel + click-to-enlarge lightbox** in
   the hero slot, a **location map** below the public remarks, the area **market
   report** at the bottom, and a **sticky "Contact an agent"** that follows scroll,
   plus **"Schedule a showing."**
4. **Buyer lead capture.** "Schedule a showing" (preferred date/time + contact) and
   "Contact an agent" (message + contact) create `leads` with `intent='buyer'`, tied
   to the listing, run through the **full pipeline** (offer → accept → status →
   scoring), routed by **proximity to the listing** (out-of-area → admin).
5. **Buyer-track scoring & lifecycle.** A **tunable duplicate** of the Seller Track:
   its own status flow, point table, and lost reasons, branching on `lead.intent`,
   but pooling into the **same four agent score tracks and the one rotation queue**
   (everyone gets both lead types).

**Non-goals / explicitly out of scope:** buyer accounts / saved searches /
favorites / email alerts (future); a homegrown AVM (separate doc); mortgage
calculators; any change to the seller funnel behavior beyond its URL move.

---

## 2. Decisions locked in requirement gathering

| # | Decision |
|---|---|
| D1 | **Buyer inquiries run the FULL existing pipeline** — offer → accept (3h) → status → scoring — not a lightweight inbox. |
| D2 | **Buyer-track scoring is a *tunable duplicate*** of seller scoring: separate status flow + point table branching on `intent`, but **shared** four score tracks and **one** rotation queue. |
| D3 | **Everyone gets both** buyer and seller leads. **No** per-agent buyer/seller opt-in or separate availability. One queue. |
| D4 | **Buyer routing = proximity to the LISTING**, out-of-area → admin unassigned (mirrors seller). "An agent" always means one of **our** agents, never the (possibly third-party) listing agent. |
| D5 | **Full interactive map search now** (Maps JS + Drawing), accepting the per-load cost; includes a multi-pin results map. |
| D6 | **12 city tiles** = mailing cities within ~20 mi of an office, ranked by active-listing count, excluding Flint / Pontiac / Detroit (exclusion list easily extended). |
| D7 | **"Schedule a showing"** collects preferred date/time + contact; **"Contact an agent"** is a message + contact. Both create buyer leads. |
| D8 | **Current homepage relocates intact** to `/sell/home-value`; nothing on it is trashed. |

---

## 3. Surface designs

### 3.1 Homepage (`/`) — buyer-first

**Move first:** relocate `app/page.tsx` → `app/sell/home-value/page.tsx` unchanged
(it is a self-contained `force-dynamic` server component). Fix its `canonical`
metadata to `${SITE_URL}/sell/home-value`. Add a `/` → new buyer homepage.

**New `/` (buyer homepage)** — a new `force-dynamic` server component:

- **Hero** with a tabbed search widget (new client component `HomeSearchHero`):
  - **Tab 1 "Search homes" (default):** one **location** input with Google Places
    Autocomplete (types `['(cities)']`/`['geocode']`, US-restricted — the exact
    `attach()` pattern from `HeroValuation`/`ValuationForm`), a **Search** button,
    and a small **"Advanced search →"** link. Submitting routes to
    `/homes?...` (city or lat/lng center). Advanced link → `/homes?advanced=1`
    (filter panel open).
  - **Tab 2 "What's my home worth?":** renders the existing valuation entry —
    address box that launches the current flow (reuse `<HeroValuation />` inline, or
    a button dispatching `OPEN_VALUATION_HEADER`). **Zero change to the valuation
    logic.** This preserves the seller funnel from the homepage.
  - Reuse `HeroBackdrop` + `getHeroImages()` for the background.
- **9 most recent active listings** — new component `HomeActiveListings` fed by a
  new query `getRecentActiveListings({ limit: 9, near: officeCoords })`:
  Active + displayable + non-lease, ordered by "most recently listed." **List-date
  caveat:** `idx_listings` has no list-date column today; use `daysOnMarket ASC` as
  the proxy (or add `ListingContractDate`/`OnMarketDate` to the sync `$select` —
  see §6, verify-against-`$metadata`). Cards = the existing `IdxListingCard`
  (variant `'sale'`) with photos via `getPhotosForListings`. Scope: within the
  service area (near an office) so the homepage stays local — **tunable** (open
  decision O1: service-area-only vs. whole feed).
- **12 city tiles** — new component `BuyerCityTiles` fed by
  `getBuyerCityTiles({ limit: 12 })` (§3.6). Each tile links to
  `/homes?city=<City>` and shows the live active-listing count ("142 homes for
  sale"). Clone `ExploreMarket`'s visual, point links at `/homes`.
- Keep `MarketStatsBar` (brokerage stats) and `ValueCta` for seller capture; keep
  `SiteFooter`. Testimonials optional.

**SEO/OG:** new homepage metadata (buyer-oriented title/description, canonical
`/`). No JSON-LD required initially. Root `layout.tsx` untouched.

### 3.2 Home search (`/homes`, new public route)

A server component that reads filters from `searchParams`, runs a new
compliance-gated search query, and renders a **results grid + interactive map**
side-by-side (map collapsible on mobile).

**New query layer — `lib/idxSearch.ts` `searchListings(filters)`** (modeled on
`getSimilarHomes` + `lib/idxAdmin.browseIdxListings`, but with public compliance
gates):

- **Always applies:** `standardStatus IN (displayable-for-sale set)`, `canDisplay`
  (entire-listing gate), `notLease`, then `.map(gateAddress)`.
- **For-sale status set (default):** `Active` + `ActiveUnderContract`. Optional
  filter to include `Pending`. **Closed excluded** from buyer search (buyers want
  available homes). (Open decision O2: include ActiveUnderContract by default?)
- **Filters (all optional, from `searchParams`):**
  | Filter | Column(s) | UI |
  |---|---|---|
  | Price min/max | `listPrice` | dual slider + inputs |
  | Beds min | `bedsTotal` | stepper / pills (Any,1+,2+,…) |
  | Baths min | `bathsTotal` | stepper / pills |
  | City / area | `city` (ILIKE) | autocomplete chip |
  | Map area | `latitude`/`longitude` | draw polygon (below) |
  | Radius from point | `lat/lng` + haversine | "use my location" / center |
  | Sqft min/max | `livingArea` | slider |
  | Year built min/max | `yearBuilt` | inputs |
  | Property type | `propertyType`/`propertySubType` | multiselect |
  | Lot size min | `lotSizeAcres` | slider |
  | Garage spaces min | `garageSpaces` | stepper |
  | Waterfront | `waterfrontYN` | toggle |
  | Pool | `poolPrivateYN` | toggle |
  | New construction | `newConstructionYN` | toggle |
  | Max HOA fee | `associationFee` (normalized) | slider |
  | Max days on market | `daysOnMarket` | slider |
  | Basement | `basement ILIKE 'finished%'` | toggle |
  | Fireplace | `fireplacesTotal > 0` | toggle |
  | Sort | listPrice/newest/DOM | select |
  - **Do NOT filter on the 6 NULL columns** (`architecturalStyle`,
    `interiorFeatures`, `appliances`, `parkingFeatures`, `lotFeatures`,
    `associationAmenities`) — the Realcomp feed zeroes them; they're empty.
- **Draw-an-area:** the client posts polygon vertices; the query bounds by the
  polygon's lat/lng bounding box (indexed after §6), then a pure `pointInPolygon`
  narrows the candidate set in JS. Rectangle/circle are bounding-box-only (cheaper).
- **Pagination:** offset/limit (e.g. 24/page), `total` count for the header.

**Interactive map — new client component `SearchMap`** (raw Maps JS via `next/script`,
`libraries=places,drawing,geometry`, key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`):

- Multi-pin markers for the current result set (price-label markers), click → card
  popover linking to `/listing/[key]`.
- **Draw tool** (Drawing library): polygon/rectangle → sets the search area →
  re-query. "Clear area" resets.
- **"Use my current location"** (browser Geolocation) → center + default radius.
- **Compliance on the map (verify-before-launch, see §5):** listings with
  `internetAddressDisplayYN=false` must not have their **street address** revealed
  — `gateAddress` nulls the address for the popover; for the **pin**, address-hidden
  actives are pinned at a **coarsened/approximate** location (or omitted) rather than
  exact coords. Flagged as a Realcomp compliance confirm.

**Results grid:** `IdxListingCard` (variant `'sale'`) in a responsive grid + the
required `<IdxCompliance firstOnPage />` block (literal "IDX" + search-use +
consumer-use + accuracy). A search page needs its **own empty state** (the shared
`IdxListingGrid` renders nothing when empty). Realcomp logo + "Listed by …" office
credit already render inside each card.

**City-scoped entry:** `/homes?city=Fenton` pre-fills the city filter (city-tile and
homepage-hero destinations).

### 3.3 Listing detail (`/listing/[listingKey]`) — enhancements

Keep the existing page; layer on the requested polish (active listings especially).
The sold path is unchanged except where noted.

- **Key-feature icon chips** — new component `KeyFeatureChips` + pure
  `buildKeyFeatures(listing)` selector, placed **directly under the beds/baths/sqft
  row**. Chips are chosen from **populated** data in a priority order, e.g.:
  - Waterfront → "On {waterBodyName}" and/or "{waterFrontageFeet} ft frontage"
    (falls back to "Waterfront" if body/frontage null).
  - Else standout picks: acreage (`lotSizeAcres`), new construction, pool, garage
    ("{garageSpaces}-car garage"), fireplaces, finished basement (`basement ILIKE
    'finished%'`), year built, low/no HOA, view. Take top ~4–6.
  - **Never** read the 6 NULL fields. Inline-SVG icons (reuse the `CategoryIcon`
    pattern already in `AreaHighlights`).
- **Photo carousel + lightbox in the hero slot** — replace the single-image
  `ListingHero` photo with a carousel (reuse `ListingGallery`'s prev/next +
  thumbnail interaction, or fold into `ListingHero`), and a new `PhotoLightbox`
  client component (click any photo → full-screen modal, keyboard/swipe nav).
  **Compliance:** full gallery only for `Active`/`ActiveUnderContract`
  (`showsFullGallery`); Pending/Closed stay primary-only.
- **Location map below the public remarks** — a dedicated single-pin map. Default to
  the **free Maps Embed API iframe** (no per-load billing; the pattern
  `AreaHighlights` already uses) so the listing page doesn't incur Maps JS cost on
  every view. **Address-hidden** listings: center on the city / coarse area, no
  exact-address label. (The existing `AreaHighlights` neighborhood-POI section stays;
  order: remarks → location map → detail sections → neighborhood highlights →
  market report.)
- **Sticky "Contact an agent"** — new `StickyContactBar` client component: a
  bottom bar (mobile) / floating side rail (desktop) with **Contact an agent** and
  **Schedule a showing** buttons that stay visible while scrolling; open the forms
  in a modal (§3.4).
- **Market report at the bottom** — already present (`MarketReport` via
  `getCityMarketReport`). No change.
- **Footer CTA:** the current page ends with a **seller** CTA ("Get my home
  value"). Keep it but make the primary listing-page CTA buyer-oriented (schedule/
  contact); keep a secondary seller link.

### 3.4 Buyer lead capture — forms + intake

Two forms (client components), opened from the sticky bar / listing page, both
carrying the listing context and `getLeadAttribution()`:

- **`ScheduleShowingForm`** — preferred **date** + **time window** + name (required)
  / email / phone / optional message.
- **`ContactAgentForm`** — name / email / phone + message.

**Intake route — `POST /api/buyer/inquiry`** (new; add to the middleware same-origin
matcher). Given `{ listingKey, kind: 'showing'|'contact', name, email, phone,
preferredDate?, preferredTime?, message?, attribution }`:

1. Load the listing (`getListingByKey`) for its coords + address + city.
2. **Create/att­ach a buyer lead** (`leads` row): `intent='buyer'`,
   `leadType='webhook'`→ (new `'buyer_inquiry'` type or reuse), `status='new'`,
   contact fields, `propertyLat/Lng` = **the listing's** coords (so routing measures
   distance to the listing), `propertyAddress`/`propertyCity` = listing's,
   `interestedListingKey` = key, `normalizedAddress` = the listing address (dedup
   key). Log `lead_events` (`'buyer_inquiry'`).
3. **Dedup (open decision O3):** if an **active** (non-closed/lost) buyer lead
   already exists for this email, attach the new listing interest as a
   `lead_event`/note to that lead instead of creating a second lead + offer (avoid
   re-offering the same buyer repeatedly). Default proposal: dedup by email within
   the active window; a brand-new or previously-closed buyer creates a fresh lead.
4. **Auto-offer:** call `autoOfferLead(leadId)` — unchanged. Proximity to the
   listing coords → nearest available agent; out-of-area → `leadOutsideAreaEmail`
   to admin, unassigned; within 7am–8pm → send offer, else queue.
5. **Showing date/time:** persist to `appointment_requests` (linked to the lead,
   `source='showing'`, add a `listingKey` column — §6) so the accepted agent sees
   the requested time; `kind='contact'` skips this.
6. Send the internal notification email (extend `appointmentNotificationEmail` to be
   source/kind-aware, include the listing link).

The agent then receives the standard offer email/SMS, accepts, and works the buyer
through the Buyer-Track pipeline (§3.5). The client-info SMS/email already sent on
accept will include the listing deep link.

### 3.5 Buyer-Track scoring & lifecycle (the tunable duplicate)

**Principle:** one pipeline, two **track configs**. Extract the seller-specific
constants behind a selector `trackConfig(intent)` returning a `TrackConfig`
(labels, `ALLOWED_TRANSITIONS`, lost-reason sets, `AGENT_SETTABLE_STATUSES`,
milestone→reason map, point deltas, update-clock deltas). `SELLER_TRACK` = today's
v4 constants (behavior unchanged); `BUYER_TRACK` = a new config, **initialized as a
mirror of seller so it's a true duplicate, then independently tunable.** The engine
functions (`recordStatusUpdate`, `applyAccept`, the milestone/fast-engagement logic,
the update clock) read the lead's intent and select the config. **Seller code paths
stay byte-for-byte behaviorally identical.**

**Routing/offers/queue:** unchanged and intent-agnostic — a buyer lead with the
listing's coords flows through `recommendAgents`/`autoOfferLead`/`agent_queue`
exactly like a seller lead. Shared four score tracks, one queue (D2/D3).

**Proposed Buyer Track status flow** (mirrors seller shape; **tunable at sign-off**):

```
new / reopened → attempted_contact → connected → buyer_touring
   → buyer_showing_scheduled → buyer_offer_submitted → buyer_under_contract → closed
   (+ lost from active stages, reopened on re-inquiry)
```

- Reuse existing enum values `new, attempted_contact, connected, closed, lost,
  reopened`.
- **New `lead_status` values** (additive; Postgres can't drop): `buyer_touring`,
  `buyer_showing_scheduled`, `buyer_offer_submitted`, `buyer_under_contract`.
- **Milestone columns reused** (a lead is one intent for its life, so the 4 existing
  `leads.milestone_*` booleans represent this track's 4 milestones — attempted,
  connected, showing_scheduled, under_contract — with no new columns and the same
  atomic once-only `claimLeadMilestone` guard).

**Proposed Buyer point table** (initial = seller mirror; independently tunable):

| Event | Buyer delta | Event | Buyer delta |
|---|---|---|---|
| Accept <15 / 15–30 / 30–60 / 1–3h | +4 / +3 / +2 / +1 | Showing Scheduled (1st) | +4 |
| Decline | −3 | Under Contract (1st) | +10 |
| No response (expired) | −4 | Closed (Won) | +25 |
| Fast-engagement (1st attempted/connected) | +4/3/2/1/0 | Touring / Lost | 0 |
| Attempted Contact (1st) | +1 | Missed update check-in | −2 (recurs) |
| Connected (1st) | +2 | — | — |

- **Score-reason enum (audit legibility + tunability):** accept-speed / decline /
  no-response / missed-check-in are **track-neutral** — reuse the existing reasons,
  and pass buyer-config deltas explicitly through `applyScore(delta)` (it already
  honors an explicit delta over the `SCORE_DELTAS` table). Add dedicated buyer
  **pipeline** reasons for audit clarity: `buyer_attempted`, `buyer_connected`,
  `buyer_showing_scheduled`, `buyer_under_contract`, `buyer_closing`,
  `buyer_fast_engagement`. (Open decision O4: dedicated buyer accept/decline reasons
  too, for a fully separate audit — heavier but cleaner.)
- **Buyer lost reasons by origin** — a parallel `BUYER_LOST_*` set (e.g. from
  `attempted_contact`: bad/wrong number; from `connected`: bought elsewhere / not
  ready / found another agent; from `buyer_touring`/`showing_scheduled`: stopped
  responding / changed plans / chose another agent; from `buyer_under_contract`:
  financing fell through / inspection killed it / buyer walked). **Tunable.**
- **Update clock** reused unchanged (24h → +7d per update, −2 missed check-in via the
  buyer reason), intent-agnostic timing.

### 3.6 Buyer city tiles — selection (`getBuyerCityTiles`)

1. Load office coordinates (`offices.latitude/longitude`; add a small `getOffices()`
   loader).
2. Per-city active-listing counts: `SELECT city, COUNT(*)` from `idx_listings` where
   `standardStatus IN ('Active','ActiveUnderContract')` + `canDisplay` + `notLease`,
   `GROUP BY city`; per city also take a representative coordinate (`AVG(latitude)`,
   `AVG(longitude)`).
3. Keep cities whose representative coord is within **~20 mi of any office**
   (`approxMiles`, already in `lib/idx.ts`).
4. Drop the **excluded** cities (`BUYER_EXCLUDED_CITIES` = Flint, Pontiac, Detroit —
   a constant now; **easily extended**; open decision O5: move to an admin-editable
   `notification_settings` field so exclusions need no deploy).
5. Rank by active count desc, take **12**. Tile image via `cityImages`/most-recent
   office-sale photo fallback (existing pattern).

### 3.7 Navigation, admin & agent surfacing

- **`SiteHeader`** (global, one edit): add **"Buy"** (→ `/homes`) and keep the
  seller/valuation entry; "Home" → `/`. "Cities" stays or becomes "Sell".
- **Agent portal:** the status picker, `PipelineBoard`, `StatusUpdateForm`,
  `AgentDashboard`, and `LeadList` carry hand-maintained status unions
  (lessons §19) — extend them to be **intent-aware**: show the Buyer-Track labels /
  transitions / lost reasons when `lead.intent==='buyer'`, and surface the
  **interested listing** (link to `/listing/[key]`) on the lead detail.
- **Admin Leads** already has an intent filter; buyer leads render with buyer status
  labels and the listing link. Lost-reason roll-up becomes intent-aware.
- The agent **Help** page (`/agent/help`) hard-codes engine constants — add a Buyer
  Track section, sourced from the new `BUYER_TRACK` config (lessons §20: mark it a
  second source of truth).

---

## 4. Data / schema changes (hand-authored idempotent SQL — lessons §1)

- **`0031_buyer_search_indexes.sql`** — add btree indexes on `idx_listings`:
  `(latitude)`, `(longitude)` (or a composite for bbox scans), `(beds_total)`,
  `(baths_total)`, `(living_area)`, `(year_built)`, `(days_on_market)`. Search/map
  filter perf (these are currently unindexed → seq scans).
- **`0032_buyer_track.sql`** — `ALTER TYPE lead_status ADD VALUE IF NOT EXISTS`
  ×4 (`buyer_touring`, `buyer_showing_scheduled`, `buyer_offer_submitted`,
  `buyer_under_contract`); `ALTER TYPE score_reason ADD VALUE IF NOT EXISTS` for the
  buyer pipeline reasons (§3.5); `ALTER TABLE leads ADD COLUMN IF NOT EXISTS
  interested_listing_key varchar(100)`; `ALTER TABLE appointment_requests ADD COLUMN
  IF NOT EXISTS listing_key varchar(100)`. (New enum values are usable only **after**
  this migration commits — any data write that references them goes in a **separate**
  later migration/runtime, per lessons §19: `ADD VALUE` can't be used in the same
  txn that adds it. We add no such backfill here — buyer statuses are only written at
  runtime.)
- **`leadType` enum** — optionally add `buyer_inquiry` (additive) or reuse
  `webhook`. Update `drizzle/schema.ts` + `meta/_journal.json` for each migration
  (SQL-only chain; never `drizzle-kit generate` — lessons §1).
- **Apply 0031–0032 in order on every Neon branch** the app + GitHub Actions use
  (lessons §11 — admin/agent pages `select` whole `leads`/`agents` rows).

---

## 5. Compliance (Realcomp IDX) — the guardrails

- Every result card + map popover: **Realcomp logo** adjacent + **"Listed by
  {listingOfficeName}"**; no RE/MAX/agent branding inside the listing body
  (`IdxListingCard` already conforms).
- Only the **displayable statuses**; buyer search uses the for-sale subset
  (`Active`(+`ActiveUnderContract`)). `canDisplay` (entire-listing gate) + `notLease`
  on every query.
- `gateAddress` before rendering any address (grid, popover, map label). **Map
  pins for `internetAddressDisplayYN=false` listings must not reveal the exact
  address** — coarsen or omit. **Verify-before-launch (V1):** confirm with Realcomp
  that mapping Active IDX listings (and the pin-precision rule for address-hidden
  ones) is permitted — carry the same caution the comps-map discussion flagged
  (current-state §9).
- One `<IdxCompliance firstOnPage />` at the top of `/homes` and the listing page
  (literal "IDX" + search-use + consumer-use + accuracy).
- **Indexing:** `/listing/[key]` stays NOINDEX unless `IDX_INDEX_LISTINGS=1`.
  `/homes` — propose **NOINDEX** initially (parameterized search pages); revisit for
  SEO later.

---

## 6. Environment / ops

- **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** must have **Maps JavaScript API** +
  **Drawing** + **Geometry** libraries enabled (Places already is; Maps Embed already
  is). It's the referrer-locked browser key — correct for client-side JS. **Cost:**
  Maps JS ~$7/1k map loads; the results map + drawing loads on `/homes` views — a new
  per-view cost the owner accepted (D5). The listing-page location map stays on the
  **free Embed API** to avoid compounding it.
- **List-date field:** to power "9 most recent listings" precisely, add
  `ListingContractDate`/`OnMarketDate` to the sync `$select` (verify it's not one of
  the zero-out fields — lessons §16b; validate against `$metadata`). Until then use
  `daysOnMarket ASC` as the proxy. Add a nullable column + mapping if pursued.
- No new server secrets. Middleware: add `/api/buyer/inquiry` to the same-origin
  matcher.

---

## 7. Open sub-decisions (to confirm at plan sign-off)

- **O1 — "9 recent listings" scope:** service-area-only (near an office) *(proposed)*
  vs. the whole displayable feed.
- **O2 — For-sale status set:** `Active` only vs. `Active + ActiveUnderContract`
  *(proposed)*; and whether a "include pending" toggle appears.
- **O3 — Buyer-lead dedup:** attach repeat inquiries from the same email to the
  existing active buyer lead *(proposed)* vs. one lead per listing inquiry.
- **O4 — Buyer score-reason granularity:** reuse track-neutral accept/decline/
  no-response reasons with explicit buyer deltas *(proposed, lighter)* vs. fully
  dedicated buyer reasons for a wholly separate audit trail.
- **O5 — Excluded-cities storage:** code constant now *(proposed)* vs. admin-editable
  setting (no deploy to change).
- **O6 — Buyer Track stage names & point values:** the §3.5 flow/table is the
  proposed *duplicate-of-seller* starting point — confirm or adjust the stage names,
  lost reasons, and deltas now (they're easy to change before the plan).

---

## 8. Phasing (high level — full plan doc follows sign-off)

1. **Relocate seller homepage** → `/sell/home-value`; redirect/nav. (Safe, isolated.)
2. **Search query + indexes** (`lib/idxSearch.ts`, `0031`) + `/homes` grid (no map
   yet) — unit-test the pure filter/pointInPolygon logic.
3. **Interactive map** (`SearchMap`: pins, draw, current-location) on `/homes`.
4. **Buyer homepage** (`/`): search hero (both tabs), 9 recent actives, 12 city
   tiles (`getBuyerCityTiles`).
5. **Listing-detail polish:** key-feature chips, carousel+lightbox, location map,
   sticky contact bar.
6. **Buyer lead intake** (`/api/buyer/inquiry`, forms, appointment listing_key) →
   auto-offer.
7. **Buyer-Track config** (`0032`, `trackConfig(intent)`, buyer lifecycle/points/
   lost reasons) + engine branch; intent-aware agent/admin surfaces; Help page.
8. **Docs** (`current-state`, `lessons-learned`, session summary), final gate
   (typecheck + tests + build; typecheck + `npm test` green after **every** phase —
   lessons §5/§6).

**Testing discipline (repo rule):** pure logic (search predicates, pointInPolygon,
`buildKeyFeatures`, `getBuyerCityTiles` ranking, the `BUYER_TRACK` transitions/point
math/lost-reason gating) is unit-tested; DB/UI wired on top. Live Maps-billing and
the Realcomp mapping-compliance confirm are owner first-connection steps (same
boundary as IDX/Places/Telnyx — lessons §12/§14/§17).
