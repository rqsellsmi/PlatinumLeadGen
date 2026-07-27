# Buyer Accounts — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-27-buyer-accounts-design.md`
**Branch:** `feature/buyer-accounts` (from `feature/buyer-search`; continues the
migration chain at **0035** — buyer-search ends at 0034).
**Approach:** phased; **typecheck + `npm test` green after every phase** (repo rule).
Pure logic (session sign/verify, referral state machine, held/release score math,
dedup decision, representation branch) is unit-tested before DB/UI. Migrations are
hand-authored idempotent SQL + `schema.ts` + `_journal.json` (never
`drizzle-kit generate`), applied in order on every Neon branch. **The seller path
and existing scoring must stay behaviorally unchanged** — the held-points work adds
an *excluded-by-default-false* column, so today's rows are unaffected.

**Migrations introduced:** `0035_buyer_users` (P1) · `0036_buyer_saves` (P2/P3) ·
`0037_buyer_lead_link` (P4) · `0038_representation_referral` (P5).

**Owner first-connection (no code):** Google OAuth client
(`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` + redirect URIs) · Turnstile keys
(`NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`) · `BUYER_SESSION_SECRET` ·
apply 0035–0038 on every branch · privacy-policy/legal review.

---

## Phase 0 — Prep (no behavior change)
- Confirm baseline green (`npm ci`, typecheck, `npm test`). Re-read the primitives
  this plan mirrors: `lib/agentPortalAuth.ts` (session HMAC + edge verify),
  `lib/agentSession.ts` (cookie set/read), the agent magic-link request/verify
  routes, `lib/leadDedup.findExistingLeadByContact`, `lib/autoOffer` (`autoOfferLead`,
  `manualReassignLead`), `lib/scoring` (`applyScore`, `recomputeRolling365`),
  `middleware.ts` (matcher + guards), the valuation entry (`/api/valuation` +
  `getRevealedValuation`/report flow).

---

## Phase 1 — Auth foundation (isolated buyer principal)

### 1a. Migration `0035_buyer_users.sql`
- `buyer_users` (`id`, `email` unique-lower, `name`, `google_sub` nullable,
  `email_verified_at`, `phone` nullable, `represented_elsewhere` bool default false,
  `created_at`, `last_seen_at`, `deleted_at`).
- `buyer_auth_tokens` (`id`, `email`, `token_hash`, `expires_at`, `used_at`,
  `created_at`; index on `token_hash`). `schema.ts` + journal `0035`.

### 1b. `lib/buyerPortalAuth.ts` (pure, unit-tested — mirror of agentPortalAuth)
- `BUYER_SESSION_COOKIE = 'bx_session'`, 30-day TTL.
- `createBuyerSession(buyerUserId)`, `verifyBuyerSession(value)`,
  `verifyBuyerSessionEdge(value, secret)` (Web-Crypto, edge). Signed with
  `BUYER_SESSION_SECRET` (fallback `NEXTAUTH_SECRET`). Distinct cookie/secret from
  admin & agent.
- `generateMagicToken()` + `hashToken()` (store the hash, not the raw token);
  30-min expiry.
- `lib/buyerSession.ts`: `getBuyerUserId()` (read cookie, server), `getCurrentBuyer()`
  (load non-deleted `buyer_users`), `setBuyerSessionCookie(id)` (httpOnly/Secure/
  SameSite=Lax/30d rolling), `clearBuyerSessionCookie()`.

### 1c. Auth routes
- **Google** (`app/api/buyer/auth/google/start` + `/callback`): `start` sets a
  short-lived signed `state` cookie → redirects to Google (`scope=openid email
  profile`). `callback` verifies `state`, exchanges the code **server-side** for
  tokens, GETs Google `userinfo` (email + `email_verified` + name), find-or-create
  buyer, set `bx_session`, redirect back to the pending action.
- **Magic link** (`app/api/buyer/auth/magic/request` + `/api/buyer/auth/magic/verify`):
  `request` = Turnstile-verify + rate-limit → create hashed token row → email the
  link (existing MS-Graph sender + a new `lib/email` template). `verify` = look up
  by hash, check expiry/unused, mark used, set `email_verified_at` + `bx_session`.
- **Sign out** (`/api/buyer/auth/signout`): clear cookie.
- `lib/turnstile.ts`: `verifyTurnstile(token, ip)` (server-side siteverify; no-op
  “pass” when unset so dev/preview isn't blocked, like the SMS no-op pattern).

### 1d. Middleware isolation
- `middleware.ts`: add `/account/:path*` + `/api/buyer/:path*` (except the auth
  routes) to the matcher; require a valid `bx_session` (`verifyBuyerSessionEdge`) or
  redirect to sign-in. **Admin/agent guards unchanged** and reject buyers; buyer
  guard rejects admin/agent cookies. Add `/api/buyer/*` mutating routes to the
  same-origin check.

### 1e. Sign-in modal
- `components/buyer/SignInModal.tsx` (client): "Continue with Google" +
  "Email me a link" (email field + Turnstile widget). Opened by a shared
  `openSignIn()` event (like `OPEN_VALUATION_EVENT`) so any "Save"/"Sign in" button
  triggers it; on success completes the pending action.

### 1f. Tests + gate
- `tests/buyerPortalAuth.test.ts`: sign/verify round-trip, tamper/expiry rejection,
  edge-verify parity, token hash. Typecheck + tests + build green.

---

## Phase 2 — Save surfaces (favorites + saved searches + /account)

### 2a. Migration `0036_buyer_saves.sql`
- `buyer_favorites` (`buyer_user_id` FK, `listing_key`, `created_at`; unique
  `(buyer_user_id, listing_key)`).
- `buyer_saved_searches` (`buyer_user_id`, `name`, `filters_json`, `anchor_lat`,
  `anchor_lng`, `created_at`).
- `buyer_listing_views` (`buyer_user_id`, `listing_key`, `first_viewed_at`,
  `last_viewed_at`, `view_count`; unique `(buyer_user_id, listing_key)`).
  *(Table created here; the write path is Phase 3.)* `schema.ts` + journal `0036`.

### 2b. APIs (all scoped to `getBuyerUserId()`; return 401 if none)
- `POST/DELETE /api/buyer/favorites` (toggle a `listingKey`).
- `GET/POST/DELETE /api/buyer/saved-searches` (create from a `SearchFilters` +
  computed area centroid + auto name via a pure `describeSearch(filters)`; delete).
- Each mutation, on **first** save, fires the Phase-4 engagement hook (guarded so it
  only triggers once per buyer until a lead exists).

### 2c. UI
- **Favorite heart** on `IdxListingCard` + the listing page (client) → toggles
  favorite; if signed-out, opens `SignInModal` and resumes.
- **"Save this search"** button on `/homes` (client) → saves current URL filters.
- **`/account`** (buyer-guarded): tabs **Saved Homes**, **Saved Searches** (each
  re-runs live via `searchListings` when opened), **My Home Value** (Phase 6),
  **Account** (name/email, sign out, Delete — Phase 8).

### 2d. Tests + gate
- `tests/buyerSaves.test.ts`: `describeSearch` naming, centroid computation from
  filters (reuse `boundingBox`/`bboxFromRadius`). Typecheck + tests green.

---

## Phase 3 — Activity tracking
- `POST /api/buyer/view` (or a server action from the listing page): upsert
  `buyer_listing_views` (`view_count++`, `last_viewed_at=now`) for the signed-in
  buyer viewing `/listing/[key]`. Fire-and-forget; no-op when signed out.
- Bounded: one row per buyer×listing (upsert), never one per pageview.
- Gate: typecheck + tests green (upsert covered by a small pure key/merge test).

---

## Phase 4 — Lead-on-engagement + dedup

### 4a. Migration `0037_buyer_lead_link.sql`
- `leads.buyer_user_id` (nullable FK → buyer_users). `schema.ts` + journal `0037`.

### 4b. `lib/buyerEngagement.ts`
- `onFirstEngagement({ buyerUserId, kind, listingKey?, savedSearch?, representation })`
  — the single entry the favorite/save/showing/contact/valuation paths call:
  1. If a lead is already linked to this buyer → attach + (if assigned) notify; done.
  2. `findExistingLeadByContact(email)` → actively-assigned buyer/seller lead →
     link `buyer_user_id`, notify that agent; done (D6).
  3. Else branch on `representation` (Phase 5 supplies it):
     - **none** → create buyer lead (`intent='buyer'`, `referral_status='eligible'`)
       + `autoOfferLead`, anchor = engagement location (search centroid or listing
       coords).
     - **our_agent** → create + **direct-assign** to `claimed_agent_id`
       (`manualReassignLead`-style), notify, `referral_status='pending_review'` (P5).
     - **other_brokerage** → **no lead**; set `buyer_users.represented_elsewhere`.
- **Pure helper (tested):** `decideEngagement(existingLead, representation)` →
  `'attach' | 'route' | 'assign-claimed' | 'suppress'`.
- The Phase-2/3 hooks call this; wire showing/contact (the buyer-search
  `/api/buyer/inquiry`) to set `buyer_user_id` when signed in.

### 4c. Tests + gate
- `tests/buyerEngagement.test.ts`: `decideEngagement` matrix. Typecheck + tests green.

---

## Phase 5 — Representation + referral + held points

### 5a. Migration `0038_representation_referral.sql`
- `agents.display_name` varchar nullable.
- New enums `representation` (`none`/`our_agent`/`other_brokerage`), `referral_status`
  (`eligible`/`pending_review`/`exempt`).
- `leads`: `representation` default `none`, `claimed_agent_id` nullable FK,
  `claimed_agent_name` text, `referral_status` default `eligible`,
  `referral_resolved_by` int, `referral_resolved_at` ts.
- `agent_score_log.is_held` bool default **false** (today's rows unaffected).
- `schema.ts` (+ enums) + journal `0038`.

### 5b. Representation question (client + wiring)
- `components/buyer/RepresentationModal.tsx`: the two-step question, shown once at
  the **first lead-creating action** before `onFirstEngagement` completes. Step 2
  agent picker = `GET /api/buyer/agents` → **all active agents** by `display_name`
  (+ "I don't see them → type a name"). Result feeds `representation` +
  `claimed_agent_id`/`claimed_agent_name` into the engagement call.
- `app/agent/settings`: add a **Display name** field (used only for the picker) →
  `agents.display_name`.

### 5c. Referral + held-points engine
- `lib/scoring.ts`:
  - `applyScore` gains an optional **`held?: boolean`** — when true, insert the log
    row with `is_held=true` and **do not** update the four tracks.
  - The rolling sum in `applyScore` **and** `recomputeRolling365` **and** the
    score-maintenance cron add `AND is_held = false` (and keep the existing negation
    behavior) so held rows never count.
  - `recordStatusUpdate` (buyer track) passes `held: true` when the lead's
    `referral_status='pending_review'` (thread the lead's status into the scoring
    block — one read).
- `lib/referral.ts`:
  - `resolveReferral(leadId, decision: 'eligible'|'exempt', adminId)` —
    set `referral_status`, `referral_resolved_by/_at`; on **eligible**: flip that
    lead's held `agent_score_log` rows `is_held=false`, add their sum to
    lifetime/ytd/monthly, `recomputeRolling365`; on **exempt**: leave them held
    (excluded) permanently. Pure `sumHeldForLead` math unit-tested.
- Admin: on the lead page, a **Referral: Eligible / Exempt** control (calls
  `resolveReferral`), plus a **"Pending referral review"** filter/badge on
  `/admin/leads`.

### 5d. Tests + gate
- `tests/referral.test.ts`: the three-state transitions; held→released sum math;
  held→exempt stays excluded; `applyScore({held:true})` doesn't move totals; the
  rolling sum excludes held rows. **Seller/existing scoring tests unchanged and
  green.** Typecheck + build green.

---

## Phase 6 — Buyer valuation in the account area
- `/account` **My Home Value**: address input (reuse the Places autocomplete) →
  runs the existing valuation (`/api/valuation`) → shows the estimate (no reveal
  gate; they're an authenticated known contact). On submit: if they have an
  assigned agent → notify that agent (potential-seller signal), store on the lead;
  else route via `onFirstEngagement` (valuation = first engagement, anchor = home).
- Gate: typecheck + tests green.

---

## Phase 7 — Agent / admin "Buyer activity" panels
- A shared `BuyerActivity` server component (favorites, saved searches with their
  filters, recently-viewed from `buyer_listing_views`) rendered on the **agent**
  lead-detail and **admin** lead pages when `lead.buyer_user_id` is set. Read-only,
  scoped to that lead.
- Gate: typecheck + tests green.

---

## Phase 8 — Privacy + delete-my-account
- `app/privacy`: add a **buyer-accounts** section (what's stored, activity
  tracking, agent/admin visibility, deletion right).
- `POST /api/buyer/account/delete`: soft-delete `buyer_users` (`deleted_at`),
  hard-delete favorites/saved-searches/views, **unlink** any lead
  (`buyer_user_id → null`, keep the CRM record — O3), clear session.
- Gate: typecheck + tests green.

---

## Phase 9 — Docs + final gate
- Update `docs/current-state.md` (buyer accounts, migrations 0035–0038, env),
  `docs/lessons-learned.md` (new §: the third-principal isolation, held-points
  design), `docs/session-summary.md`.
- **Final gate:** typecheck clean, `npm test` all green, `npm run build` compiles;
  record the test count.

---

## Open sub-decisions to confirm before/at build (from spec §8)
O1 Google consent verification · O2 `leadType='buyer_account'` vs reuse ·
O3 delete = unlink (proposed) vs full delete · O4 saved-search routing centroid
(polygon vs city). **Parked (not built): P1 seller-side representation, P2
ad-sourced pre-existing policy.**

## Ordering / risk notes
- P1 is self-contained (new principal, no change to existing flows). P2–P3 are
  additive surfaces. P4 introduces the lead link but reuses the proven dedup/route
  path. **P5 is the deepest** (touches `applyScore`) — the `is_held` column defaults
  false so existing scoring is untouched; the held path only activates for
  `pending_review` leads. P6–P8 layer on. Each phase leaves the tree green and is
  committed with a message mapping to this plan; push per phase.
