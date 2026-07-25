# Buyer Side — Home Search + Buyer-Lead Pipeline — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-25-buyer-search-design.md`
**Branch:** `feature/buyer-search`
**Approach:** phased; **typecheck (`npm run typecheck`) + `npm test` green after every
phase** (repo rule, lessons §5/§6). Pure logic (search predicates, point-in-polygon,
`buildKeyFeatures`, city-tile ranking, the `BUYER_TRACK` transitions/points/lost
gating, buyer-dedup decision) is **unit-tested before** the DB/UI layers wire on top.
Migrations are hand-authored idempotent SQL + `schema.ts` + `_journal.json` (never
`drizzle-kit generate` — lessons §1), applied in order on every Neon branch.

**Confirmed decisions (owner, 2026-07-25):** O1 service-area · O2 Active+AUC only,
AUC shows real status · O3 one lead per buyer email · O4 neutral+buyer-pipeline
reasons · O5 admin-editable exclusions (tiles only) · O6 buyer flow reuses seller
statuses, drops `appointment_set`, buyer lost reasons, **`closed → nurturing`**
(repeat client) allowed.

**Migrations introduced (aligned to the phase that needs them):**
`0031_buyer_search_indexes` (P2) · `0032_buyer_home_settings` (P4) ·
`0033_buyer_lead_fields` (P6) · `0034_buyer_track_reasons` (P7).

---

## Phase 0 — Prep (no code)
- Re-read `lib/idx.ts` gates, `IdxListingCard`/`IdxListingGrid`, `HeroValuation`
  autocomplete, `autoOfferLead`, `recordStatusUpdate`, `leadLifecycle.ts` (already
  inventoried in the scratchpad `inv-*.md`). No behavioral change.
- Confirm `npm ci` done, baseline `npm run typecheck` + `npm test` green.

---

## Phase 1 — Relocate the seller homepage → `/sell/home-value`
Goal: move the current homepage intact; keep `/` working (buyer homepage lands in P4).

- Extract the current `app/page.tsx` body into a reusable async server component
  `components/home/SellerHomepage.tsx` (all six `Promise.all` loaders + render tree,
  verbatim). Accept an optional `variant` if needed; default identical.
- `app/sell/home-value/page.tsx` (new) — renders `<SellerHomepage />`; owns the
  seller metadata (title/description) with `canonical = ${SITE_URL}/sell/home-value`.
- `app/page.tsx` — for now also renders `<SellerHomepage />` (so `/` is unchanged
  and green) with the existing homepage metadata. **P4 replaces this file's body**
  with the buyer homepage.
- `components/SiteHeader.tsx` — add a link to `/sell/home-value` under the sell/value
  entry (keep "Free Home Value" modal button). No "Buy" yet (P4).
- Redirect nicety (optional): none required; both routes resolve.
- **Verify:** typecheck + build; `/` and `/sell/home-value` both render the seller
  homepage. No test changes.

---

## Phase 2 — Search query layer + indexes + `/homes` grid (no map yet)

### 2a. Migration `0031_buyer_search_indexes.sql`
- `CREATE INDEX IF NOT EXISTS` on `idx_listings`: `(latitude)`, `(longitude)`
  (+ a composite `(latitude, longitude)` for bbox scans), `(beds_total)`,
  `(baths_total)`, `(living_area)`, `(year_built)`, `(days_on_market)`.
- Add nothing to `schema.ts` columns (indexes only); add the index defs to the
  `idxListings` table's index block for parity; journal entry `0031`.

### 2b. `lib/idxSearch.ts` (new) — the public search query
- `export interface SearchFilters { priceMin?, priceMax?, bedsMin?, bathsMin?, city?,
  sqftMin?, sqftMax?, yearMin?, yearMax?, propertyTypes?: string[], lotAcresMin?,
  garageMin?, waterfront?, pool?, newConstruction?, hoaMax?, domMax?, basementFinished?,
  fireplace?, includePending?: false, bbox?: {minLat,minLng,maxLat,maxLng},
  polygon?: {lat,lng}[], center?: {lat,lng}, radiusMiles?, sort?: 'price_asc'|
  'price_desc'|'newest'|'dom', page?, pageSize? }`
- `export async function searchListings(f: SearchFilters): Promise<{ rows: IdxCard[];
  total: number }>`:
  - **Always:** `standardStatus IN ('Active','ActiveUnderContract')`, `canDisplay`,
    `notLease`. (Reuse the exact fragments from `lib/idx.ts`; export them if needed.)
  - Map each filter to a Drizzle predicate (price/beds/baths/sqft/year/type/lot/
    garage/waterfrontYN/poolPrivateYN/newConstructionYN/associationFee/daysOnMarket/
    `basement ILIKE 'finished%'`/`fireplacesTotal > 0`). **Never** touch the 6 NULL
    columns.
  - Geo: `center`+`radiusMiles` → bbox prefilter (indexed lat/lng) then exact
    haversine; `bbox` → lat/lng between; `polygon` → bbox prefilter then pure
    `pointInPolygon` in JS on candidates.
  - `sort`, `limit`/`offset`, `count(*)` for `total`. `.map(gateAddress)`.
- **Pure helpers (unit-tested):** `pointInPolygon(pt, ring)` (ray cast),
  `boundingBox(polygon)`, `normalizeFilters(searchParams)` (querystring → typed
  `SearchFilters`, clamps/whitelists). Keep these side-effect-free.

### 2c. `app/homes/page.tsx` (new, `force-dynamic`, NOINDEX)
- Read `searchParams` → `normalizeFilters` → `searchListings` →
  `getPhotosForListings`.
- Render: a header (result count + active filter chips), `components/search/
  SearchFilterPanel.tsx` (client — controls that write the URL querystring; sliders
  for price/sqft/lot/hoa/dom, pills/steppers for beds/baths/garage, toggles for
  waterfront/pool/new-construction/basement/fireplace, property-type multiselect,
  sort), the results grid (`IdxListingCard` variant `'sale'` in a responsive grid),
  an **explicit empty state**, pagination, and one `<IdxCompliance firstOnPage />`.
- `?city=` / `?advanced=1` honored (city tiles + homepage hero destinations).

### 2d. Status-accurate cards (O2)
- Edit `components/idx/IdxListingCard.tsx` (+ `ListingHero` in P5): derive a display
  status label from `standardStatus`/`mlsStatus` — Active → "For Sale";
  ActiveUnderContract → the real label ("Under Contract" / "Accepting Backup Offers"
  from `mlsStatus`, fallback "Under Contract"); never label AUC as plain "For Sale".
  Add a small `listingStatusLabel(listing)` helper (pure, tested).

### 2e. Tests
- `tests/idxSearch.test.ts`: `pointInPolygon` (inside/outside/edge), `boundingBox`,
  `normalizeFilters` (clamping, whitelist, bad input), `listingStatusLabel` (Active
  vs AUC vs mlsStatus variants).
- **Gate:** typecheck + `npm test` green; `/homes` returns compliance-gated results.

---

## Phase 3 — Interactive map (`SearchMap`) on `/homes`

- `components/search/SearchMap.tsx` (client) — raw Maps JS via `next/script`
  (`libraries=places,drawing,geometry`, key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`),
  following the `HeroValuation`/`ValuationForm` script-load pattern:
  - Price-label markers for the current result set; click → popover card linking to
    `/listing/[key]` (address via `gateAddress` — never reveal a hidden address).
  - **Draw tool** (Drawing library): polygon/rectangle → capture vertices → push to
    the URL (`?poly=` encoded) → re-query via `searchListings`. "Clear area" resets.
  - **"Use my location"** (browser Geolocation) → `center` + default `radiusMiles`.
  - **City autocomplete** in the map/search bar (Places, `types:['(cities)']`) →
    sets `city`/`center`.
- `/homes` layout: results grid + map side-by-side (map collapsible on mobile);
  keep it a server page that renders the client `SearchMap` with the current rows.
- **Compliance:** `internetAddressDisplayYN=false` listings → pin coarsened (round
  lat/lng) or omitted from the map; never show their address in the popover. Add a
  pure `coarsenIfHidden(listing)` helper (tested).
- Tests: `coarsenIfHidden`; polygon round-trip encode/decode helper.
- **Gate:** typecheck + tests green; draw/current-location/autocomplete filter the
  grid. (Live Maps billing is an owner enable-step — §Env.)

---

## Phase 4 — Buyer homepage (`/`)

### 4a. Migration `0032_buyer_home_settings.sql`
- `ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS buyer_excluded_cities
  text` (comma/JSON list; seed `'Flint,Pontiac,Detroit'` via the migration's UPDATE
  where null). `schema.ts` + journal `0032`.

### 4b. Query helpers (`lib/queries.ts` or new `lib/buyerHome.ts`)
- `getOffices()` — `db.select().from(offices).where(isActive)`; returns coords.
- `getRecentActiveListings({ limit=9, near: officeCoords })` — Active+AUC, `canDisplay`,
  `notLease`, service-area (within ~20mi of an office via `approxMiles`), order
  `daysOnMarket ASC` (most-recent proxy — §Env list-date caveat), `photoUrl` not null.
- `getBuyerCityTiles({ limit=12 })` — per-city active counts (`groupBy city`,
  Active+AUC, gates) + representative `AVG(lat/lng)`; filter within 20mi of an office;
  drop `buyer_excluded_cities` (read from settings, default Flint/Pontiac/Detroit);
  rank by count desc; tile image via existing `cityImages`/office-sale-photo fallback.
  - **Pure helper (tested):** `rankBuyerCityTiles(cityStats, offices, excluded, limit)`
    — the filter/exclude/within-radius/rank/slice logic, separated from the DB read.

### 4c. Components + page
- `components/home/HomeSearchHero.tsx` (client) — tabbed widget:
  - Tab "Search homes" (default): a location Places-autocomplete input
    (`types:['(cities)','geocode']`, reuse the `attach()` pattern), Search button →
    `/homes?city=…` or `/homes?lat=&lng=`, and a small "Advanced search →" →
    `/homes?advanced=1`.
  - Tab "What's my home worth?": renders `<HeroValuation />` inline (unchanged flow)
    or a button dispatching `OPEN_VALUATION_HEADER`. Zero valuation-logic change.
  - Background: `HeroBackdrop` + `getHeroImages()`.
- `components/home/HomeActiveListings.tsx` — 9 `IdxListingCard`s (variant `'sale'`).
- `components/home/BuyerCityTiles.tsx` — clone `ExploreMarket` visual; tiles link
  `/homes?city=<City>`, show live active count.
- `app/page.tsx` — replace body with the **buyer homepage**: `SiteHeader` → search
  hero → `HomeActiveListings` → `BuyerCityTiles` → `MarketStatsBar` (brokerage) →
  `ValueCta` → `SiteFooter`. New buyer metadata (canonical `/`).
- `components/SiteHeader.tsx` — add **"Buy" → `/homes`**; keep Sell/value entries.

### 4d. Tests
- `tests/buyerHome.test.ts`: `rankBuyerCityTiles` (exclusion, 20mi filter, count
  ranking, limit, excluded-city still not in tiles but note search unaffected).
- **Gate:** typecheck + tests green; `/` is the buyer homepage, `/sell/home-value`
  the seller one.

---

## Phase 5 — Listing-detail enhancements (`app/listing/[listingKey]/page.tsx`)

- `components/idx/KeyFeatureChips.tsx` + pure `buildKeyFeatures(listing): Chip[]`
  (in `lib/listingFeatures.ts`): priority-ordered picks from **populated** fields —
  waterfront ("On {waterBodyName}" / "{waterFrontageFeet} ft frontage" / "Waterfront"),
  acreage, new construction, pool, garage ("{n}-car garage"), fireplaces, finished
  basement, year built, low/no HOA, view. Take top ~4–6. **Never** the 6 NULL fields.
  Inline-SVG icons (reuse `AreaHighlights` `CategoryIcon` style). Placed directly
  under the beds/baths/sqft row.
- `components/idx/PhotoLightbox.tsx` (client) — full-screen modal, keyboard/swipe/
  arrows, counter. Carousel in the hero slot: fold `ListingGallery` interaction into
  the hero (or render the gallery there); clicking any photo opens the lightbox.
  Gallery only when `showsFullGallery` (Active/AUC); Pending/Closed primary-only.
- Location map below public remarks — free **Maps Embed iframe** single pin (the
  `AreaHighlights` pattern); address-hidden → city/coarse center, no address label.
- `components/idx/StickyContactBar.tsx` (client) — sticky bottom bar (mobile) /
  floating rail (desktop): **Contact an agent** + **Schedule a showing**; opens the
  P6 forms in a modal. Stays visible on scroll.
- Reorder the page: hero(carousel) → stat bar → key-feature chips → beds/baths/sqft
  → public remarks → **location map** → two-column detail → `AreaHighlights` →
  `MarketReport` → compliance/footer. Make the primary CTA buyer-oriented; keep a
  secondary seller "Get my home value" link. AUC hero badge shows real status (2d).
- Tests: `tests/listingFeatures.test.ts` — `buildKeyFeatures` (waterfront path,
  non-waterfront standout picks, NULL-field avoidance, cap).
- **Gate:** typecheck + tests green.

---

## Phase 6 — Buyer lead intake (forms → pipeline)

### 6a. Migration `0033_buyer_lead_fields.sql`
- `ALTER TABLE leads ADD COLUMN IF NOT EXISTS interested_listing_key varchar(100)`.
- `ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS listing_key varchar(100)`.
- `ALTER TYPE lead_type ADD VALUE IF NOT EXISTS 'buyer_inquiry'`.
- `schema.ts` (+ enum member) + journal `0033`.

### 6b. `lib/buyerInquiry.ts` (new)
- `createBuyerInquiry(input): Promise<{ leadId; created: boolean; offered: boolean }>`:
  1. `getListingByKey(listingKey)` → coords/address/city (404 → error).
  2. **Dedup (O3):** `findActiveBuyerLead(email)` (intent=buyer, status not in
     closed/lost). If found → insert a `lead_events` note (new interested listing +
     message), update `interestedListingKey`, **do not** re-offer; return
     `{created:false, offered:false}`.
  3. Else insert `leads`: `intent='buyer'`, `leadType='buyer_inquiry'`, `status='new'`,
     contact, `propertyLat/Lng` = **listing coords**, `propertyAddress/City` =
     listing's, `interestedListingKey`, `normalizedAddress` = listing address;
     `lead_events('buyer_inquiry')`.
  4. `kind==='showing'` → insert `appointment_requests` (`source='showing'`,
     `listingKey`, `preferredTime` = date+window, `notes` = message, attribution).
  5. `autoOfferLead(leadId)` (unchanged; proximity to listing, out-of-area→admin,
     offer-window aware). Return `offered` from its result.
  - **Pure helper (tested):** `decideBuyerInquiry(existingLead | null)` → `'attach' |
    'create'` (the dedup decision), separated from DB.
- `lib/validation.ts`: `buyerInquirySchema` (`listingKey`, `kind`, name required,
  email required for routing, phone, `preferredDate?`, `preferredTime?`, `message?`,
  attribution). Reuse `isValidPersonName`.
- `lib/email.ts`: make `appointmentNotificationEmail` kind/listing-aware (subject +
  listing deep link), or add `buyerInquiryNotificationEmail`.

### 6c. Route + forms + middleware
- `app/api/buyer/inquiry/route.ts` (POST, `nodejs`, `force-dynamic`) → validate →
  `createBuyerInquiry` → JSON. Rate-limit (`checkPreset`).
- `middleware.ts` — add `/api/buyer/inquiry` to the matcher (same-origin POST guard).
- `components/search/ScheduleShowingForm.tsx` + `ContactAgentForm.tsx` (client) —
  carry `listingKey` + `getLeadAttribution()`; opened from `StickyContactBar`.
- Tests: `tests/buyerInquiry.test.ts` — `decideBuyerInquiry`, `buyerInquirySchema`.
- **Gate:** typecheck + tests green; a showing/contact submit creates a buyer lead
  and auto-offers (verified by the pure decision + schema tests; live routing needs
  a DB, same boundary as seller flow).

---

## Phase 7 — Buyer-Track config + engine branch + surfacing

### 7a. Migration `0034_buyer_track_reasons.sql`
- `ALTER TYPE score_reason ADD VALUE IF NOT EXISTS` ×5: `buyer_attempted`,
  `buyer_connected`, `buyer_signed`, `buyer_closing`, `buyer_fast_engagement`.
  `schema.ts` enum + journal `0034`. (Usable only after commit — runtime writes come
  later, no same-txn use.)

### 7b. Track config (`lib/leadLifecycle.ts` + `lib/scoring.ts`, or new `lib/trackConfig.ts`)
- `export interface TrackConfig { settableStatuses; allowedTransitions;
  isBackwardMove; lostReasonsForOrigin(origin, attemptedCount); labels;
  milestoneReason(status); pipelineDelta(status); fastEngagementReason;
  acceptReason(band); }`.
- `SELLER_TRACK` = today's v4 constants (wraps the existing `ALLOWED_TRANSITIONS`,
  `AGENT_SETTABLE_STATUSES_V4`, `lostReasonsForOrigin`, `SCORE_DELTAS` mapping,
  milestone→reason). **Behavior identical.**
- `BUYER_TRACK`:
  - Statuses: reuse `new, attempted_contact, connected, nurturing, signed, closed,
    lost, reopened`. Settable = `attempted_contact, connected, nurturing, signed,
    closed, lost`.
  - Transitions: `new/reopened → {attempted_contact, connected}`;
    `attempted_contact → {connected, lost}`; `connected → {nurturing, lost}`;
    `nurturing → {signed, lost}`; `signed → {closed, lost, nurturing(back)}`;
    **`closed → {nurturing}`** (repeat client); `lost → {}`. No `appointment_set`.
  - `BUYER_LOST_A/A2/B/C/D` per the schema table (§3.5 spec); A2 gated at ≥6
    attempted-contact logs (reuse `canMarkLost` count logic).
  - Milestone→reason: attempted→`buyer_attempted`(+1), connected→`buyer_connected`
    (+2), signed→`buyer_signed`(+10); closed→`buyer_closing`(+25, direct);
    nurturing→none/0. Fast-engagement→`buyer_fast_engagement` (+4/3/2/1/0).
  - Accept/decline/no-response/missed-check-in: **neutral reasons**, seller-equal
    deltas (config carries the delta so it's tunable later).
- `trackConfig(intent: LeadIntent): TrackConfig` — `'buyer' → BUYER_TRACK`, else
  `SELLER_TRACK`.

### 7c. Engine branch (minimal, seller path untouched)
- `lib/statusUpdates.ts recordStatusUpdate`: load `lead.intent`; select
  `cfg = trackConfig(intent)`; use `cfg` for settable-check, transition validation,
  backward-move detection, lost-reason gating, milestone claim + **reason/delta**
  (buyer pipeline reasons via `applyScore(reason, delta)`), fast-engagement reason.
  Milestone columns reused (`milestone_attempted_contact/connected/signed`).
- `lib/offerActions.ts applyAccept`/`applyDecline`: keep neutral reasons; optionally
  read `cfg.acceptReason`/delta (currently seller-equal → no behavior change).
- Update clock (`nextUpdateDeadline`, missed-check-in −2): unchanged, intent-agnostic.
- **Guard the seller path:** existing seller tests must stay green unchanged — the
  branch only activates for `intent==='buyer'`.

### 7d. Intent-aware surfacing
- Agent: `StatusUpdateForm`, `PipelineBoard`, `AgentDashboard`, `LeadList`,
  `lib/agentLeads` — render buyer labels/transitions/lost reasons when
  `lead.intent==='buyer'` (drive the status/lost pickers from `trackConfig`). Lead
  detail shows the **interested listing** (link to `/listing/[key]`). (Lessons §19:
  update every hand-maintained status union — typecheck will walk you to them.)
- Admin: Leads intent filter already exists; `/admin/lost-reasons` becomes
  intent-aware; buyer lead detail shows the listing link.
- `app/agent/help/page.tsx` — add a **Buyer Track** section sourced from `BUYER_TRACK`
  (mark it a second source of truth, lessons §20).

### 7e. Tests
- `tests/buyerTrack.test.ts`: transitions (valid/invalid; `closed→nurturing` allowed;
  `new→signed` rejected; no `appointment_set`), `BUYER_LOST_*` gating (incl. A2 ≥6),
  buyer milestone points (attempted/connected/signed/closed once-only), fast-engagement
  bands, `trackConfig('buyer')` vs `trackConfig('seller')` selection.
- Re-run the full seller suite unchanged (must stay green).
- **Gate:** typecheck + `npm test` green.

---

## Phase 8 — Docs + final gate
- `docs/current-state.md` — buyer surfaces, `/homes`, buyer track, migrations 0031–34,
  env additions.
- `docs/lessons-learned.md` — new **§21** (activating an inert `intent` flag as a
  track selector; reusing enum values instead of adding buyer_* statuses; the
  IdxListingCard status-accuracy seam; Maps-JS/Drawing compliance for hidden addresses).
- `docs/session-summary.md` — prepend a buyer-side session summary.
- **Final gate:** `npm run typecheck` clean, `npm test` all green, `npm run build`
  compiles. Record the new test count.

---

## Owner first-connection / verify-before-launch (not code)
- **Enable Maps JavaScript API + Drawing + Geometry** on
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Places/Embed already on); billing on. Cost:
  Maps JS ~$7/1k `/homes` loads (accepted, D5).
- **Realcomp compliance confirm (V1):** mapping Active/AUC IDX listings and the
  pin-precision rule for `internetAddressDisplayYN=false` listings — confirm permitted
  (current-state §9 carried the same caution).
- **List-date (optional):** add `ListingContractDate`/`OnMarketDate` to the sync
  `$select` (validate against `$metadata`; not one of the six zero-out fields) to
  replace the `daysOnMarket ASC` "most recent" proxy.
- **Apply migrations 0031–0034 in order** on every Neon branch (app + GitHub Actions).

---

## Dependency / ordering notes
- P1 is isolated (safe first). P2→P3 (map builds on the query). P4 depends on P2's
  card + P3 nothing (homepage hero just links to `/homes`). P5 is independent polish.
  P6 depends on the listing page (P5 sticky bar) + `autoOfferLead` (existing). P7 is
  the deepest (touches the proven scoring engine) — done after the buyer lead exists
  (P6) so there are buyer leads to move through the track. P8 last.
- Each phase leaves the tree typechecking and the site functional; commit per phase
  with a message mapping to this plan.
