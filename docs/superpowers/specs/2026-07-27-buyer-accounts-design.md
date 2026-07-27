# Buyer Accounts — Saved Searches, Favorites & Activity — Design Spec

**Date:** 2026-07-27
**Status:** Draft design — pending sign-off
**Branch:** proposed `feature/buyer-accounts` (from `feature/buyer-search`)
**Author:** Requirement-gathering session (superpowers workflow)
**Related:** `docs/superpowers/specs/2026-07-25-buyer-search-design.md` (the buyer
search this builds on), `docs/current-state.md` §4.9, the seller lead pipeline.

---

## 1. Summary

Let buyers **browse the whole site anonymously**, and add an **optional account**
(no passwords, ever) so they can **save searches, save favorite homes, see their
own home's valuation, and have their activity tracked**. A buyer becomes a routed
**lead only on real engagement** (first save / contact / showing / valuation), and
the whole system treats **one person as one lead handled by one agent** — matched
by email across buyer *and* seller leads.

At that first engagement the buyer is asked **if they're already working with an
agent** (§5.7). This protects existing representation and drives the **referral fee**:
every site lead is **`referral_eligible` (flat 30%) by default**; a claimed
pre-existing RE/MAX Platinum agent puts the lead in **`pending_review`** — assigned
to that agent for service, but with the **fee and the agent's points *held*** until
an **admin** resolves it (release or exempt). Admin is the sole arbiter.

The buyer is a **third, strictly-isolated principal** alongside admin (NextAuth)
and agents (signed cookie). It gets its own session cookie and can never reach
admin/agent data.

**Non-goals (future):** saved-search email alerts; buyer↔agent messaging; social
features; mortgage tools; native app / Apple sign-in.

---

## 2. Decisions locked in requirement gathering

| # | Decision |
|---|---|
| D1 | **Browse freely without an account.** An account is required only to *save* things. |
| D2 | **Passwordless auth only — no stored credentials.** Two methods: **Sign in with Google** (OAuth) and **email magic link**. |
| D3 | **Buyer is a strictly separate principal** — own cookie, **30-day rolling session**, never reaches `/admin`, `/agent`, or anyone else's data. |
| D4 | **Account creation ≠ lead.** On signup we track activity + **dedup by email to link identity** (and remember any assigned agent), but route **no lead yet**. |
| D5 | **Lead is created/attached on first real engagement** — save a search, save a home, or submit contact/showing/valuation. Dedup by email: actively-assigned lead → **notify that agent**; otherwise **create + route**. |
| D6 | **One person = one lead = one agent.** All activity (buying saves, showings, *and* their own home valuation) attaches to the single lead and notifies the one assigned agent. Never a second lead or second agent for the same email. |
| D7 | **Routing anchor = the FIRST engagement's location** — the first saved search's area (city/centroid), or the home for a saved-home/showing/contact. It does not change as they add more searches. |
| D8 | **Buyer valuation:** logged-in buyers can enter their address and see their home's valuation; it **notifies their assigned agent** (potential-seller signal), not a new lead. (Edge case: if they have no lead yet, the valuation is the first lead-triggering action.) |
| D9 | **Saved searches store the filter set and re-run live** against current listings (no email alerts yet). **Favorites** = saved homes. |
| D10 | **Agent + admin can see** each buyer's activity (viewed homes, favorites, saved searches) on the lead record. |
| D11 | **Data minimization:** email + name at signup; **phone required only at appointment/showing.** |
| D12 | **Bot defense:** invisible **Cloudflare Turnstile** + rate-limiting on the magic-link path; Google's own defenses cover the Google path; **verified email required** before any agent-notify. |
| D13 | **Privacy:** disclose activity tracking in the privacy policy + provide **"delete my account & data."** |
| D14 | **"Already working with an agent?" — two-step**, asked **at the first lead-creating action** (not at signup): "working with an agent?" → if yes, "a RE/MAX Platinum agent?". Captures both *represented-anywhere* and *which-of-ours*. (See §5.7.) |
| D15 | **Agent picker = ALL active agents** (regardless of availability — it's an *existing* relationship, not a new-lead request) + **"I don't see them → type a name."** Shows a new `agents.display_name` (nickname), settable in agent settings, used only for this picker for now. |
| D16 | **Working with another brokerage → no lead, no outreach.** The account still works fully (browse/favorite/save); the buyer is flagged **"represented elsewhere"** internally. |
| D17 | **Working with one of ours → assign the lead directly to that agent** (skip the rotation) + **notify them**. The claim is trusted for *service*, but **not** for the referral fee (see D18). A typed name that matches no active agent → **admin reconciles** (no auto-route). |
| D18 | **Referral fee — brokerage-wide, flat 30%, three states.** `referral_status` on every site lead: **`eligible` (default — the fee stands)**, **`pending_review`** (set only when a buyer claims a *pre-existing Platinum agent*), **`exempt`** (admin-confirmed no fee). **Admin is the sole arbiter** — no agent-confirmation step — via a **one toggle** on the lead + a **"pending referral review" queue**. |
| D19 | **Held points.** A `pending_review` lead **logs its point events but HOLDS them** (excluded from the agent's totals + queue). Admin resolves the one toggle: **`eligible` → release** the held points; **`exempt` → they stay excluded.** Prevents an agent farming their own book through the site to climb the queue while dodging the fee. |

---

## 3. Auth architecture (the isolation core)

**Buyers are their own principal**, modeled on the *agent* pattern (a proven,
isolated, cookie-based session) — NOT folded into the admin NextAuth instance (a
buyer session there could satisfy the admin `authorized` guard). No passwords are
stored for buyers under any method.

- **Session** (`lib/buyerAuth.ts`, mirroring `lib/agentPortalAuth`): an
  **HMAC-signed, httpOnly, Secure, SameSite=Lax cookie** `bx_session` carrying the
  `buyerUserId`, **30-day rolling** expiry (refreshed on activity). Verified at the
  edge in `middleware.ts`. Distinct cookie name + secret from admin/agent, so the
  admin (`auth()`) and agent (`AGENT_SESSION_COOKIE`) guards never accept it, and
  the buyer guard never accepts theirs.
- **Method 1 — Sign in with Google** (`/api/buyer/auth/google/start` →
  `/callback`): standard OAuth 2.0 authorization-code flow. `start` redirects to
  Google (`scope=openid email profile`, a CSRF `state` in a short-lived signed
  cookie). `callback` verifies `state`, exchanges the code **server-side** (with
  the client secret) for tokens, then reads Google's **userinfo** endpoint for
  `email` + `email_verified` + `name`. Because the exchange is server-to-server
  over TLS with our secret, the email is trusted (no id_token JWKS verification
  needed — keeps it dependency-free). Find-or-create the buyer by email → set
  `bx_session`.
- **Method 2 — Email magic link** (`/api/buyer/auth/magic/request` → email →
  `/api/buyer/auth/magic/verify?token=…`): mirrors the agent magic-link — a
  single-use, short-lived (30 min) token row; the emailed link click **verifies
  the email** and sets `bx_session`. Guarded by Turnstile + rate-limit (D12).
- **Isolation guarantees (enforced, not assumed):**
  - `middleware.ts` matcher adds `/account/:path*` + `/api/buyer/:path*` — buyer
    routes require a valid `bx_session`; admin/agent guards are unchanged and
    reject buyers.
  - Every buyer API re-derives `buyerUserId` from the cookie server-side and scopes
    every read/write to that id (a buyer can only ever see/modify their own
    favorites, searches, views, lead) — the same "re-verify ownership on every
    mutation" rule as the agent lead-edit (lessons §20).
  - The buyer principal has **no path** to `/admin`, `/agent`, or other buyers'
    data. No shared session store with admin/agent.

---

## 4. Data model (new tables + one FK)

Hand-authored idempotent SQL migrations (repo rule):

- **`buyer_users`** — `id`, `email` (citext/lower-unique), `name`, `googleSub`
  (nullable), `emailVerifiedAt`, `phone` (nullable — filled at first appointment),
  `createdAt`, `lastSeenAt`, `deletedAt` (soft-delete for D13).
- **`buyer_auth_tokens`** — magic-link tokens: `id`, `email`, `tokenHash`,
  `expiresAt`, `usedAt`, `createdAt`. (Mirror of the agent magic-link storage;
  store a hash, not the raw token.)
- **`buyer_favorites`** — `buyerUserId` → buyer_users, `listingKey`, `createdAt`;
  unique `(buyerUserId, listingKey)`.
- **`buyer_saved_searches`** — `buyerUserId`, `name` (auto-generated e.g. "Fenton ·
  under $400k", editable), `filtersJson` (the `SearchFilters` set), `anchorLat`/
  `anchorLng` (the search-area centroid, for routing), `createdAt`.
- **`buyer_listing_views`** — activity log for agent/admin insight: `buyerUserId`,
  `listingKey`, `firstViewedAt`, `lastViewedAt`, `viewCount`; unique
  `(buyerUserId, listingKey)` and **upsert** on each view (bounds volume — one row
  per buyer×listing, not one per pageview).
- **`agents` addition:** `display_name` (varchar, nullable) — the agent's nickname
  for the representation picker (falls back to legal `firstName lastName`).
  Settable in `/agent/settings`; used only for this picker for now (D15).
- **`leads` additions:**
  - `buyer_user_id` (nullable FK → buyer_users) — links a routed lead to the
    account. (Buyer leads already use `intent='buyer'`, `leadType='buyer_inquiry'`.)
  - **Representation:** `representation` (enum `none`/`our_agent`/`other_brokerage`,
    default `none`), `claimed_agent_id` (nullable FK → agents), `claimed_agent_name`
    (text — the typed name when unmatched).
  - **Referral:** `referral_status` (enum **`eligible`** default / **`pending_review`**
    / **`exempt`**), `referral_resolved_by` (admin id), `referral_resolved_at`.
    Brokerage-wide — applies to seller leads too (default `eligible`), so seller
    leads are covered by the admin toggle without any seller-form change (D18).
- **`agent_score_log` addition:** `is_held` (boolean, default false). A held row is
  logged but **excluded** from the four score-track totals **and** the rolling-365
  recompute until released (D19). On admin resolve: `eligible` → set `is_held=false`
  (the deltas now count); `exempt` → set `is_negated=true` (never count — reuses the
  existing negation path). `applyScore` learns an optional `held` arg; the score
  aggregations add `WHERE is_held = false AND is_negated = false`.

New enums: `representation`, `referral_status`. No new `lead_status`/`score_reason`
values (buyer accounts reuse the buyer-search pipeline). `leadType` may gain
`buyer_account` (additive) to distinguish an account-originated lead from a bare
listing inquiry — TBD (open O2).

---

## 5. Flows

### 5.1 Sign up / sign in
Anonymous browsing needs nothing. When a buyer clicks **Save**, **favorite**, or
**Sign in**, show a lightweight modal: "Continue with Google" or "Email me a link."
On success → `bx_session` set → the pending action (the save they clicked) completes.

**On account creation (find-or-create by verified email):**
1. Upsert `buyer_users` by email; set `emailVerifiedAt`, `googleSub` if Google.
2. **Identity dedup (link only, D4):** `findExistingLeadByContact(email)` (the
   existing seller-pipeline dedup) — if a buyer *or* seller lead exists, record the
   link (`leads.buyer_user_id`) and note any assigned agent. **No lead routed.**
3. Begin activity tracking (views).

### 5.2 First real engagement → lead (D5/D6/D7)
When the buyer first **saves a search / saves a home / submits contact / showing /
valuation**, and no lead is yet routed for them:
1. **Ask the representation question** (D14, §5.7) — a one-time modal at this first
   lead-creating action. Its answer branches everything below.
2. Dedup by email (`findExistingLeadByContact`). If an **actively-assigned**
   buyer/seller lead exists → **notify that agent** (mirror the seller-resubmit
   notify path), link `buyer_user_id`, done — no new lead, no re-route.
3. Else branch on the representation answer:
   - **No agent** → **create a buyer lead** (`intent='buyer'`, linked
     `buyer_user_id`, `referral_status='eligible'`) and `autoOfferLead` it. **Anchor**
     = the first engagement's location (saved search → area centroid `anchorLat/Lng`;
     saved home / showing / contact → that listing's coordinates).
   - **Our agent** → create the lead but **assign it directly to that agent**
     (skip rotation, like `manualReassignLead`), notify them, set
     `referral_status='pending_review'` + hold points (§5.7).
   - **Another brokerage** → **no lead**; flag the buyer `represented_elsewhere`;
     the account keeps working (§5.7).
4. Every later save/showing attaches to the **same** lead (dedup by email/
   buyer_user_id) and, if assigned, just notifies the agent.

### 5.3 Buyer valuation (D8)
A logged-in buyer enters their address in the account area → runs the **existing
valuation** (RentCast/ATTOM AVM) → sees the estimate (no reveal gate — they're an
authenticated known contact). Then:
- If they already have an assigned agent → **notify that agent** ("your client also
  wants a valuation / may be a seller"); store the valuation on their lead.
- If they have no lead yet → this valuation is the **first lead-triggering action**
  → create + route one lead anchored on their **home address** (a seller-flavored
  signal, but still one lead / one agent).

### 5.4 Saved searches & favorites (D9)
- **Favorite** a home (heart on cards + listing page) → `buyer_favorites` upsert.
- **Save this search** on `/homes` → `buyer_saved_searches` stores the current
  `SearchFilters` + area centroid + an auto name. Opening it **re-runs live**
  against current listings.
- **Account area** (`/account`): My Saved Homes, My Saved Searches, My Home Value,
  Account (name/email, sign out, **Delete my account**).

### 5.5 Agent / admin visibility (D10)
The agent lead-detail page and the admin lead page gain a **"Buyer activity"**
panel for buyer-linked leads: favorites, saved searches (with filters), and
recently-viewed homes (from `buyer_listing_views`). Read-only; scoped to that lead.

### 5.6 Delete my account (D13)
`/account/delete` → soft-delete `buyer_users` (`deletedAt`), hard-delete
`buyer_favorites` / `buyer_saved_searches` / `buyer_listing_views`, clear the
session. **Any lead already created stays** as the brokerage's CRM record but is
**unlinked** (`buyer_user_id → null`) and noted — disclosed in the privacy policy
(a lead the agent is already working is business data; the *consumer login +
activity* is what's deleted). (Open O3: full lead deletion vs unlink.)

### 5.7 Representation & referral (the "already-represented" case)
Fires **once, at the first lead-creating action** (D14) — never at signup, so
signup stays frictionless and bare accounts never touch an agent.

**The two-step question:** "Are you already working with a real estate agent?"
→ if **yes** → "Is it a RE/MAX Platinum agent?"
- **Yes, Platinum** → a picker of **all active agents** by `display_name` (D15), plus
  **"I don't see them → type a name."**
- **Yes, other brokerage** → captured as `other_brokerage`.
- **No** → normal flow.

**Outcomes:**
| Answer | Lead? | Assignment | Referral | Points |
|---|---|---|---|---|
| No agent | Yes | normal rotation (`autoOfferLead`) | `eligible` | count normally |
| Our agent (picked) | Yes | **direct-assign to that agent** + notify | **`pending_review`** | **held** |
| Our agent (typed, unmatched) | Yes | **admin reconciles** (no auto-route) | `pending_review` | held |
| Other brokerage | **No** | none (respect representation) | n/a | n/a |

**Referral is a three-state field, brokerage-wide (D18):**
- **`eligible`** — the default on every site lead (buyer *and* seller); the flat
  **30%** stands. Points count immediately (today's behavior).
- **`pending_review`** — set *only* when a buyer claims a pre-existing Platinum
  agent. The lead is assigned + the agent notified (for service), but **the fee and
  the points are both suspended** pending an admin decision. Surfaces in an admin
  **"pending referral review"** queue/filter.
- **`exempt`** — admin confirmed no fee.

**The one admin toggle (D18/D19)** on the lead resolves a `pending_review`:
- **→ `eligible`**: release the **held points** into the agent's totals; the 30%
  stands.
- **→ `exempt`**: held points stay excluded; no fee.
Admin is the **sole arbiter** — there is no agent self-confirmation (agents would
never volunteer "not my client"). Every claim/resolution is logged
(`representation`, `claimed_agent_*`, `referral_resolved_by/_at`).

**Held points mechanic (D19):** while a lead is `pending_review`, `applyScore`
still **logs** each event to `agent_score_log` but with `is_held=true`, and the
four score-track aggregations + the rolling-365 recompute **exclude held (and
negated) rows** — so the agent sees *nothing* from this lead until admin resolves.
This blocks the gaming vector (running your own book through the site to climb the
queue while dodging the fee) and needs no time-based auto-release — it waits for
the human.

---

## 6. Security (your two priorities: PII + bots)

- **No stored credentials.** Google + magic link only → no password hashes to
  leak, no reset flow to exploit, no credential stuffing.
- **Data minimization** (D11): email + name only until an appointment needs phone.
  Viewing history is one upserted row per buyer×listing, not a keystroke log.
- **Strict principal isolation** (§3): distinct cookie/secret; middleware guards;
  every buyer API scoped to the caller's own `buyerUserId`.
- **Verified email before agent-notify** (D12): Google returns `email_verified`;
  the magic link's click proves inbox control. We never notify an agent (or dedup-
  act) on an unverified email — stops someone triggering notifications for an
  address they don't own.
- **Bot / spam defense** (D12): **Cloudflare Turnstile** (invisible) on the
  magic-link request + **rate-limit** magic-link + account creation per IP (reuse
  the Neon limiter). Google's own defenses cover its path. Lead routing only on
  real engagement (D5) keeps bot accounts out of the agent queue entirely.
- **Cookie hardening:** httpOnly + Secure + SameSite=Lax + signed; OAuth `state`
  CSRF cookie; magic-link tokens single-use, short-lived, stored hashed.
- **Privacy policy** updated to disclose account activity tracking, what's stored,
  agent/admin visibility, and the deletion right.
- **IDX/consumer-data note (verify-before-launch):** storing a named consumer's
  saved/viewed IDX listings is standard for an IDX consumer portal, but confirm
  Realcomp's IDX terms permit it and that we don't expose one broker's data beyond
  the display rules already enforced.

---

## 7. Environment / ops (owner setup, no code)
- **Google OAuth:** create an OAuth client (free) → `GOOGLE_OAUTH_CLIENT_ID` +
  `GOOGLE_OAUTH_CLIENT_SECRET`; add authorized redirect URIs per environment
  (preview + prod). Consent screen with non-sensitive scopes (email/profile).
- **Turnstile:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (free).
- **Buyer session secret:** `BUYER_SESSION_SECRET` (HMAC; or reuse an existing
  secret — separate value preferred).
- Magic-link email uses the existing MS-Graph sender. Apply the new migrations on
  every Neon branch.

---

## 8. Open sub-decisions (confirm at plan sign-off)
- **O1 — Google verification / branding:** the OAuth consent screen may show an
  "unverified app" notice until published; fine for launch, or complete Google's
  quick review first?
- **O2 — `leadType` for account-originated leads:** add `buyer_account` vs reuse
  `buyer_inquiry`.
- **O3 — Account deletion scope:** unlink the lead but keep it as CRM data
  *(proposed)* vs fully delete the lead too.
- **O4 — Saved-search area for routing:** city-name centroid vs the map polygon's
  centroid when the search was drawn on the map (use polygon centroid when present,
  else city).

### 🚩 Parked — revisit later (owner flagged, NOT part of this build)
- **P1 — Seller-side pre-existing clients.** Should the seller valuation forms ask
  the same "already working with an agent?" question the buyer flow does? Deferred —
  the owner wants to maximize SEO + ad lead volume and is weighing that against the
  funnel friction. **No decision yet, and it does NOT block this build:** seller
  leads are already covered by the brokerage-wide `referral_status` (default
  `eligible`) + the admin toggle, with no seller-form change. Mirror the buyer
  representation flow onto the seller forms only if/when the owner chooses to.
- **P2 — Ad-sourced pre-existing clients.** Policy for a lead that is *both* a
  claimed pre-existing client *and* arrived via a paid ad (has a `gclid`/UTM):
  should it be exemptible at all, given ad spend was involved? Deferred. **Interim
  behavior:** default `eligible`, admin decides case-by-case, with "came through an
  ad" shown prominently on the lead in the admin referral view. Revisit whether to
  add a hard rule (ad-sourced ⇒ non-exemptible).

## 9. Phasing (high level — full plan after sign-off)
1. **Auth foundation:** `buyer_users` + `buyer_auth_tokens`, `lib/buyerAuth`
   (signed cookie), middleware isolation, Google OAuth routes, magic-link routes,
   Turnstile + rate-limit. Sign-in modal. (Pure token/cookie logic unit-tested.)
2. **Save surfaces:** `buyer_favorites` + `buyer_saved_searches` + favorite hearts
   + "Save this search"; the `/account` area; live re-run of saved searches.
3. **Activity tracking:** `buyer_listing_views` upsert on listing views.
4. **Lead-on-engagement + dedup:** wire first-save/contact/showing/valuation to the
   dedup + create/attach/notify logic; `leads.buyer_user_id`; routing anchor.
5. **Representation + referral + held points:** the two-step question at first
   engagement; `agents.display_name` (+ agent-settings field); the direct-assign +
   notify path for a claimed agent; `leads.representation`/`claimed_agent_*`;
   `leads.referral_status` (three states) + `agent_score_log.is_held`; the
   score-aggregation exclusion of held/negated rows; the **admin referral toggle +
   pending-review queue** that releases or excludes held points. (Pure held/release
   score math + the three-state transitions unit-tested; seller path unchanged.)
6. **Buyer valuation** in the account area (reuse the AVM flow) + agent-notify.
7. **Agent/admin "Buyer activity" panels.**
8. **Privacy policy + delete-my-account.**
9. **Docs + final gate** (typecheck + tests + build green after each phase).

Owner first-connection items (Google OAuth client, Turnstile keys, Realcomp IDX
confirm, migrations) mirror the pattern of every prior integration.
