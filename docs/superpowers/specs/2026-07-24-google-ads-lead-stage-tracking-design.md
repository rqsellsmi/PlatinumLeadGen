# Google Ads Lead-Stage Offline Conversion Tracking — Design Spec

**Date:** 2026-07-24
**Status:** Draft design — pending owner sign-off on the Open Decisions (§13)
**Branch:** `feature/google-ads-tracking` (off `refinements-v1`)
**Source brief:** `REMAX_Platinum_Google_Ads_Lead_Stage_Integration_Spec.docx`
(the vendor "Developer Implementation Specification", updated 2026-07-22)
**Author:** Requirement-gathering session (superpowers workflow)
**Reconciles against:** `docs/current-state.md` §4.3/§4.6, `drizzle/schema.ts`,
`lib/statusUpdates.ts`, `lib/scoring.ts`, `lib/googleAdsConversions.ts`

---

## 1. Summary

Send **server-side offline conversions** to Google Ads when a seller lead reaches
three CRM pipeline milestones — **first-time Nurturing** (the authoritative
"valid seller lead" signal), **first-time Signed**, and **first-time Closed** —
via Google's **Data Manager API** (`events:ingest`). The CRM is the source of
truth: a qualifying first-entry into one of those stages writes one row to a new
**`google_ads_conversion_outbox`** table inside the existing status-change code
path, and a **background worker** (a new cron endpoint on the existing GitHub
Actions schedule) delivers it to Google, records the request id/status, retries
transient failures, and reconciles daily.

This is **additive** to the four **client-side** Google Ads conversions that
already fire today (`lib/googleAdsConversions.ts`, account `AW-17043745770`:
Seller Valuation $100, Hero/PPC $75, Seller Guide $20, Appointment $150). Those
are visitor/form-time browser conversions. What's new here is a **CRM-driven,
pipeline-stage, offline** conversion pipeline that no part of the current system
has — the bidding signal moves from "someone submitted a form" toward "an agent
worked this into a real listing opportunity."

Scope is **Seller Track only** (the only track built; Buyer Track is a future
placeholder, per current-state §4.3). Phase 1 sends **one event to one
destination per request** (traceable request ids), no conversion values, and
keeps the existing form conversion as the Primary bidding signal until the new
"Valid Seller Lead" import is proven.

---

## 2. Why this needs a spec, not just the vendor doc

The vendor `.docx` is thorough but was written **against assumed column/flag
names**, not this codebase. Its own §12 "rollout checklist" is essentially a list
of "confirm against the real schema" items. Reading it against the actual code
(Rule #1: confirm, never theorize — `lessons-learned.md` §0) surfaced several
places where the assumed mechanism **does not exist** and must be built, and one
place where a naming collision must be avoided. This spec's job is that
reconciliation. §3 is the load-bearing part.

---

## 3. Reconciliation: vendor assumptions vs. the real code

| # | Vendor spec assumes… | Reality in this repo | Resolution |
|---|---|---|---|
| R1 | A per-event **`first_time` flag** on `lead_events` gates each milestone. | `lead_events` has **no** `first_time` column (`event_type` is a free `varchar(100)`; entries are `status_updated`/`marked_lost`/etc.). Scoring's once-only-ness lives on `leads.milestone_*` booleans, but those exist only for attempted/connected/appointment/signed. | Don't reuse that flag or those columns. Use the **outbox table's `UNIQUE(lead_id, milestone)` constraint** as the once-only guard (R2). |
| R2 | First-time **Nurturing** is the primary conversion trigger. | Nurturing scores **0 points** and has **no guard** (`LeadMilestone = 'attempted_contact' \| 'connected' \| 'appointment_set' \| 'signed'`, `lib/scoring.ts:229`; `grep milestone_nurturing` → none). Nurturing *is* a revert target (`appointment_set→nurturing`, `signed→nurturing` backward moves). | **No new column.** Enqueue on every nurturing entry with `ON CONFLICT (lead_id, milestone) DO NOTHING` — the first entry inserts, a backward-then-forward re-entry is a no-op. (Owner decision 2026-07-24: no transaction/claim machinery — the unique index is the guard.) |
| R3 | First-time **Closed** is a trigger and must be sent once even if the lead later loops back to Nurturing. | Closed calls `applyScore('system_closing')` with no guard, but **`ALLOWED_TRANSITIONS` has `closed: []`** — Closed is **terminal**. The "Closed→Nurturing loop" the vendor worries about **cannot happen in this app**; Closed is reached exactly once (Signed→Closed). | **No new column.** The unique-constraint enqueue fires once naturally. The vendor's Closed-safeguard is moot here (documented, not built). |
| R4 | Insert the outbox row **"in the same DB transaction"** as the `lead_events` write; API call after commit. | `recordStatusUpdate` is **not wrapped in an explicit transaction** — it's sequential awaits. **Owner explicitly wants nothing transaction-based.** | The enqueue is a plain `INSERT … ON CONFLICT DO NOTHING` sequential await in the status-change path — no `BEGIN`, no atomic-claim `UPDATE`, no wrapping transaction. The DB unique index does the dedup. |
| R5 | Existing "Form Completed" conversion needs a deterministic `lead:{id}:form_completed` transaction id. | The form conversion is **client-side gtag** with `hero-`/`appointment-` id prefixes (`lib/googleAdsConversions.ts`), fired after the backend save. | **Proposed (D3):** leave it as-is in Phase 1; only add the 3 offline conversions. Re-keying or server-siding the form conversion is a separate, optional change (Open Decision). |
| R6 | Send `ad_user_data` / `ad_personalization` consent per event; "add the columns or point at the existing consent record." | **No advertising consent is captured anywhere** — no schema column, no form field (the privacy policy references consent only in prose). | **Proposed (D1):** send `CONSENT_STATUS_UNSPECIFIED` in Phase 1 (US-only MI leads; enhanced matching + click-id attribution still function). Explicit capture is a later, opt-in enhancement (Open Decision). |
| R7 | Leads timestamps are `TIMESTAMP` without tz — "confirm UTC, convert to RFC 3339." | Confirmed: all lead/event timestamps are Drizzle `timestamp()` (no tz), written via `.defaultNow()` / `new Date()` on Neon = **UTC**. | Worker converts with an explicit `…toISOString()` (RFC-3339 `Z`). Never rely on server-local tz. |
| R8 | "Send from a background worker so a Google outage can't delay the agent." | Established pattern exists: `app/api/cron/dispatch-queued-offers` is pinged by `.github/workflows/cron.yml` every ~10 min with `x-cron-secret`. | Model the Google worker on it exactly: a new `/api/cron/google-ads-dispatch` route + a step in `cron.yml`. Each Data Manager send is a single quick HTTP call, so — unlike the IDX feed — it does **not** need to run on the GH runner. |
| R9 | Persist/refresh an OAuth credential for Google. | Established pattern: `ms_graph_tokens`, `realcomp_tokens` single-row token caches with self-heal on 401 (`lessons-learned.md` §12d). | Reuse the pattern: a `google_ads_tokens` cache (or in-memory per-invocation mint if using a service account) + on-auth-error re-mint. |

**Bottom line:** the trigger mechanism the vendor doc leans on (`lead_events.first_time`) doesn't exist, and (per the 2026-07-24 owner decision) we do **not** add milestone-guard columns or transaction/claim machinery. **The only new schema is the outbox table itself, whose `UNIQUE(lead_id, milestone)` index is the entire once-only mechanism.** Enqueue on every qualifying entry; the DB rejects duplicates.

---

## 4. Decisions (proposed — pending sign-off)

| # | Decision | Default proposed here | Status |
|---|---|---|---|
| D1 | **Consent signal** | Send a **constant** `CONSENT_STATUS_UNSPECIFIED` (or `GRANTED`) per event — US/MI leads, first-party ads; **no capture UI or column**. Google's EU-consent policy doesn't apply to US traffic. Counsel confirm before go-live. | **Resolved** (owner 2026-07-24; value UNSPECIFIED vs GRANTED still to pick) |
| D2 | **Data Manager API auth** | Service-account credential stored as a secret, token cached/refreshed like `realcomp`/`ms_graph`. | **Open** (§13) |
| D3 | **Existing form conversion** | Leave the client-side "Form Completed" conversion untouched; add only the 3 offline conversions. | **Open** (§13) |
| D4 | **This session's scope** | Produce **this spec + the work plan only**; implementation begins on approval. | **Open** (§13) |
| D5 | **Once-only mechanism** | The outbox `UNIQUE(lead_id, milestone)` index only. **No** `milestone_nurturing`/`milestone_closed` columns, **no** `claimLeadMilestone` changes, **no** transactions. | **Locked** (owner 2026-07-24) |
| D6 | **Trigger set** | Nurturing → `VALID_SELLER_LEAD`, Signed → `LISTING_SIGNED`, Closed → `CLOSED`. Attempted/Connected/Appointment-Set/Lost/Reopened = **no** conversion. | **Locked** (from vendor §3) |
| D7 | **Nurturing eligibility** | Enqueue on every nurturing entry; the unique index makes it fire once. In this app you can't reach Signed/Closed without first passing Nurturing, so the "unless signed/closed already occurred" clause is already satisfied by the unique index (no extra check needed). | **Locked** (design) |
| D8 | **Conversion values** | Omit in Phase 1 (no invented dollar values). Column exists in the outbox but stays null. | **Locked** (from vendor §7) |
| D9 | **Bidding cutover** | Keep the existing form action **Primary**; import the three offline actions **Secondary**; promote "Valid Seller Lead" to Primary only after imports are proven (owner does this in the Google Ads UI, not code). | **Locked** (from vendor §7) |
| D10 | **Worker runtime** | Vercel cron route pinged by GitHub Actions `cron.yml` (`x-cron-secret`); one event per request. | **Locked** (design) |
| D11 | **Eligibility allowlist** | Export only approved seller lead types/sources. Today **all** leads are the seller-valuation workflow, so the allowlist defaults to "all current types," expressed as a config constant so future buyer/webhook types are excluded by default. | **Locked** (design; from vendor §6) |

---

## 5. Trigger model (the heart)

### 5.1 Milestone → conversion mapping
```
nurturing  (first time, no prior signed/closed) → VALID_SELLER_LEAD
signed     (first time)                         → LISTING_SIGNED
closed     (first time)                         → CLOSED
```
Everything else (`new`, `attempted_contact`, `connected`, `appointment_set`,
`lost`, `reopened`, backward moves) → **no outbox row**.

### 5.2 Once-only via the outbox unique index (no columns, no claims, no tx)
In `recordStatusUpdate` (after the timeline write, alongside the existing scoring
block; **not** on a backward move), for each of the three trigger statuses, run
one guarded insert:

```
enqueue(milestone) =
  insert google_ads_conversion_outbox {
    lead_id,
    source_event_id = <the lead_events id just written>,
    milestone,                                    // valid_seller_lead | listing_signed | closed
    occurred_at    = <event time, UTC>,
    transaction_id = `lead:${leadId}:${milestone}`,
    conversion_action_id = CONFIG[milestone],
    event_source   = PHONE (SMS/phone update) | WEB (portal/e-sign) | OTHER,
    export_status  = 'pending'
  }
  ON CONFLICT (lead_id, milestone) DO NOTHING
```

- `nurturing → enqueue('valid_seller_lead')`
- `signed → enqueue('listing_signed')`
- `closed → enqueue('closed')`

**Why this is sufficient (and why no signed/closed pre-check is needed):** the only
path into Nurturing is `connected→nurturing`, and the only path to Signed is
`…→nurturing→appointment_set→signed`. So **every** lead that ever reaches Signed or
Closed already fired `valid_seller_lead` on its first Nurturing. A later
`signed→nurturing` backward move re-enters Nurturing, but the `(lead_id,
'valid_seller_lead')` row already exists → `DO NOTHING`. The unique index alone
gives the exact "fire once per milestone per lead" behavior the vendor wanted,
with no boolean columns, no atomic claim, and no transaction — matching the owner's
2026-07-24 direction. Closed is terminal (`ALLOWED_TRANSITIONS closed: []`), so it
enqueues once by construction.

---

## 6. Schema changes (migration `0031_google_ads_outbox`)

Head is `0030_agent_password_reset`; next is **`0031`**. Hand-authored idempotent
SQL + `schema.ts` + `meta/_journal.json` (repo rule, `lessons-learned.md` §1). This
is a **single-table** migration — no new `leads` columns, no enum `ADD VALUE`, so no
split is needed (contrast §19).

**6.1 New table `google_ads_conversion_outbox`** — delivery record, not pipeline
history. Columns (vendor §5, typed to this repo's conventions):

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | repo uses `serial`, not bigserial/uuid |
| `lead_id` | `integer` FK → `leads(id)` | |
| `source_event_id` | `integer` FK → `lead_events(id)` | the first-time status event |
| `milestone` | `varchar(40)` | `valid_seller_lead` / `listing_signed` / `closed` |
| `occurred_at` | `timestamp` | milestone time (UTC) |
| `event_source` | `varchar(16)` | `PHONE` / `WEB` / `OTHER` |
| `conversion_action_id` | `varchar(120)` | Google destination id captured for audit |
| `transaction_id` | `varchar(120)` | `lead:{id}:{milestone}`, **UNIQUE** |
| `conversion_value` | `numeric` NULL | omitted Phase 1 |
| `currency` | `char(3)` NULL | |
| `export_status` | `varchar(16)` | `pending`/`submitted`/`processing`/`accepted`/`error`/`ineligible` |
| `export_attempts` | `integer` default 0 | |
| `google_request_id` | `varchar(120)` NULL | from `events:ingest` |
| `submitted_at` | `timestamp` NULL | |
| `next_retry_at` | `timestamp` NULL | backoff schedule |
| `last_error` | `text` NULL | sanitized |
| `created_at` / `updated_at` | `timestamp` default now | |

Constraints/indexes: `UNIQUE(lead_id, milestone)`, `UNIQUE(transaction_id)`,
`UNIQUE(source_event_id)`, index `(export_status, next_retry_at)` for the worker,
index `(google_request_id)` for reconciliation.

**6.2 No new `leads` columns.** (Superseded by the 2026-07-24 owner decision —
the outbox unique index is the once-only guard; `leads.milestone_*`,
`claimLeadMilestone`, and consent columns are all untouched.)

**6.3 Consent:** no column, no form field. The worker sets the per-event
`consent.{adUserData,adPersonalization}` to a **constant** from config (D1). US/MI,
first-party ads — no capture needed.

**6.4 Optional token cache** `google_ads_tokens` (single row, mirrors
`realcomp_tokens`) — needed only if D2's auth method caches a refreshed token.

---

## 7. Status-change integration point

Single hook site: **`lib/statusUpdates.ts recordStatusUpdate`**, the shared core
already used by *both* the agent portal and the inbound SMS commands
(`lessons-learned.md` §17). Adding the enqueue here means **one behavior, every
entry point** — a status set from the portal, from a `SIGNED`/`CLOSED` SMS, or
from a future API all emit the conversion identically, with zero duplication.

- The enqueue lives next to the existing v4 scoring block, gated by `!backward`.
- It is **best-effort/try-caught** exactly like the scoring block (`console.error`
  on failure, never throws) — a Google-outbox hiccup must never break an agent's
  status update. On failure the row simply isn't enqueued.
- The insert is a single `INSERT … ON CONFLICT (lead_id, milestone) DO NOTHING` —
  the unique index does the dedup; there is no transaction, no claim, no read-check.
- `event_source` is derived from the update's channel if the status event records
  one (SMS command ⇒ `PHONE`; portal ⇒ `WEB`), else `OTHER`.

**Manual/admin corrections:** an admin editing an already-sent milestone must go
through an audited adjustment path, **never** a silent outbox delete (vendor §3).
Phase 1 simply never deletes outbox rows; a retraction tool is out of scope.

---

## 8. The export worker (`/api/cron/google-ads-dispatch` + `lib/googleAdsOutbox.ts`)

Modeled on `dispatch-queued-offers` (§R8). `runtime=nodejs`,
`dynamic=force-dynamic`, `x-cron-secret` gate. Pinged by a new step in
`cron.yml` (~10 min). Steps per run:

1. Select outbox rows `export_status IN ('pending', retryable 'error')` with
   `next_retry_at` due; **join `leads`**; require `is_deleted=false` (vendor:
   suppress deleted) and the **eligibility allowlist** (D11). Mark ineligible
   rows `ineligible` with a reason (auditable, not deleted).
2. Build normalized, SHA-256-hashed identifiers (email/phone/name) — pure,
   unit-tested (`lib/googleAdsHash.ts`); **click ids (gclid/gbraid/wbraid) are sent
   raw, never hashed**. Apply consent exactly as stored / the D1 default; never
   infer `GRANTED`.
3. `POST https://datamanager.googleapis.com/v1/events:ingest` — one event, one
   destination, `validateOnly` driven by an env flag (true in QA, false in prod).
   The call runs **outside** any agent request.
4. On success: store `google_request_id`, set `submitted_at`, `export_status`
   `submitted`, increment `export_attempts`. On transient failure: leave
   retryable, set `next_retry_at` (exponential backoff + jitter), record sanitized
   `last_error`. **`transaction_id` never changes across retries.**
5. Poll `requestStatus.retrieve` (a second worker pass or the same route) →
   `accepted` / `processing` / `error`. Permanent validation errors → an admin
   alert / review state, not an infinite retry.
6. **Daily reconciliation** (add to `scheduled-daily.yml`): find stale
   `pending`/`submitted`/`processing`/retryable-`error` rows so nothing is
   silently dropped.

**Data Manager request mapping** (vendor §8) is followed verbatim:
`destinations[].operatingAccount` = `{GOOGLE_ADS, <customerId>}`,
`productDestinationId` = the milestone's action id, `events[]` with
`eventTimestamp` (RFC-3339 Z), `transactionId`, `eventSource`,
`adIdentifiers.{gclid,gbraid,wbraid}` (raw), `userData.userIdentifiers[]`
(hashed email/phone, `encoding: HEX`), `consent.{adUserData,adPersonalization}`.

**Hashing rules** (vendor §8, unit-tested with known vectors — QA test #11):
email trimmed+lowercased (gmail/googlemail: strip dots in local part); phone
E.164 then hashed; UTF-8 → lowercase 64-hex SHA-256; never re-hash an existing
digest; never hash click ids.

**Never logged:** raw PII, click ids, hashed identifiers, or OAuth creds
(vendor §10; matches the repo's existing "never log the payload" posture).

---

## 9. Config & secrets (matches the repo's env conventions)

New env (secured config, never in source — `.env.example` documents them):
- `GOOGLE_ADS_CUSTOMER_ID` (digits only)
- `GOOGLE_ADS_ACTION_ID_VALID_SELLER_LEAD` / `_LISTING_SIGNED` / `_CLOSED`
- Auth (per D2): e.g. `GOOGLE_ADS_SA_KEY` (service-account JSON) **or** OAuth
  client/refresh vars.
- `GOOGLE_ADS_VALIDATE_ONLY` (`1` during QA).
- Read with `||` (not `??`) so an empty GH-Actions secret falls back, never
  overrides — the `$$`/empty-secret trap (`lessons-learned.md` §12d).

**Set in every environment that reads it** — Vercel (the app enqueues + the cron
route sends) *and* GitHub Actions (the ping). Same "set it in both places" trap as
`REALCOMP_OFFICE_KEYS` (`lessons-learned.md` §15).

---

## 10. Attribution & consent (mostly verify, not build)

`leads` already holds `gclid`, `gbraid`, `wbraid`, `utm_*`, `landing_page_url`,
`referrer`, `device_type`, `session_id`, `first_seen_at`/`last_seen_at`,
`first_name`/`last_name`/`email`/`phone` (current-state §3, confirmed in schema).
Phase-1 attribution work is **verification, not new columns** (vendor §4):

- Run test submissions carrying GCLID/GBRAID/WBRAID/UTMs and confirm the values
  **survive navigation** and land on the committed `leads` row; measure null-rate
  by paid campaign before launch (QA tests #2/#3).
- `report_token` is **never exported** (sensitive). `session_id` is retained for
  troubleshooting, not sent as a Google identifier.
- Consent: per D1, `UNSPECIFIED` in Phase 1. If D1 flips to explicit capture, add
  the two consent columns + a form field and thread them through the worker.

---

## 11. Eligibility, late events, and edge cases

- **Eligibility allowlist (D11):** a config constant of approved `lead_type`/
  `source` values; the worker filters on it and marks non-matches `ineligible`.
  Defaults to the current seller-valuation types; future buyer/webhook types are
  excluded until explicitly added.
- **63-day window (vendor §9):** enhanced-conversion lead events older than 63
  days from the last ad click may not import. Signed/Closed can occur later than
  that. The CRM records them permanently regardless; this is *why* Valid Seller
  Lead (fast, near listing-quality) is the intended steady-state bidding signal.
- **Lead merge:** retain the winning lead's attribution + outbox history; don't
  enqueue duplicate milestones from both rows (the `UNIQUE(lead_id,milestone)` +
  transaction-id dedup make Google-side double-counting impossible even if a merge
  slips).
- **Soft-delete / reopen / lost:** never delete accepted outbox history; a
  reopened lead keeps its milestone booleans (no re-pay, no re-enqueue).

---

## 12. QA test plan (maps to vendor §11)

The 17 vendor QA cases map cleanly; the ones that become **automated unit tests**
in this repo (pure logic, no DB/creds — the repo's testing boundary,
`lessons-learned.md` §17) and the ones that are **owner first-connection** checks:

- **Unit-testable now:** hash vectors (#11), transaction-id determinism (#4/#7/#8),
  the eligibility filter, `event_source` derivation, the nurturing-eligibility /
  Closed-safeguard logic (#6/#7/#10), RFC-3339 timestamp formatting (#5-adjacent),
  the request-body builder shape (#14 without a live call).
- **Owner first-connection (needs real creds/GCLID, same boundary as IDX/Telnyx):**
  live `validateOnly` (#14), request-status retrieval (#15), Ads reporting by
  action (#16), GCLID capture/persistence through live forms (#2/#3), API-failure
  retry against a real timeout (#13), late-milestone behavior (#17).

Everything Google-live is unrunnable in a code-only sandbox (no creds) — the same
boundary hit by the IDX feed, Google Places, and Telnyx. Plan Phase-by-phase
verification is typecheck + `npm test` green after each phase, matching the repo
rule.

---

## 13. Open Decisions (need owner sign-off before implementation)

1. **D1 — Consent. RESOLVED (owner 2026-07-24):** no consent capture is needed for
   US/MI first-party ads (Google's EU-consent policy doesn't apply to US traffic).
   The worker sends a **constant** consent value. Only remaining pick: send
   `CONSENT_STATUS_UNSPECIFIED` (recommended — most accurate, no signal is actively
   collected) or `GRANTED` (policy acceptance treated as consent). Counsel confirm
   before go-live is the standard caveat; no engineering difference.
2. **D2 — Data Manager API auth.** Default proposed: a **service-account
   credential** stored as a secret, tokens cached/refreshed like
   `realcomp`/`ms_graph`. Alternatives: an OAuth refresh token, or keyless
   Workload Identity Federation (most secure, awkward on Vercel). This also
   determines whether `google_ads_tokens` is needed and what the owner must
   provision in Google Cloud.
3. **D3 — Existing form conversion.** Default proposed: leave the client-side
   "Form Completed" conversion untouched; add only the three offline conversions.
   Alternatives: re-key it to `lead:{id}:form_completed` for deterministic
   cross-path dedup, or move it fully server-side (largest change).
4. **D4 — This session's scope.** Default proposed: deliver **this spec + the work
   plan** and stop for review (matches the superpowers approved-design → plan
   sign-off → build flow). Alternatives: also start the Phase-1 foundation
   (migration + milestone guards), or build the whole integration this session.
5. **D11 confirmation — Eligibility allowlist.** Confirm the exact `lead_type`/
   `source` values approved for export (default "all current seller-valuation
   types"). Owner also needs to confirm the **three Google Ads conversion action
   ids** and the **customer id** (§9) — these are created by the Google Ads admin
   (vendor §7).

---

## 14. Non-goals / explicitly out of scope (Phase 1)

- No conversion **values** (no invented dollars; vendor §7/D8).
- No **batching** — one event per request for traceable request ids (vendor §8);
  batch later only if volume needs it.
- No **Google Sheets** path as a normal route — documented manual fallback for
  recovery/backfill only (vendor §8).
- No **admin retraction/adjustment UI** for already-sent conversions (audited
  process is a later item; Phase 1 just never silently deletes).
- No **Buyer Track** (placeholder; current-state §4.3).
- No change to the four existing **client-side** conversions (unless D3 says so).
- No **Appointment Set** conversion in Phase 1 (a possible future Secondary
  diagnostic; vendor §3).

---

## 15. Definition of done (Phase 1, from vendor §13, made concrete)

- Every eligible seller lead's **first** Nurturing, Signed, and Closed event
  creates **exactly one** outbox row (`UNIQUE(lead_id, milestone)`), with no change
  to the agent's workflow.
- Attempted/Connected/Appointment-Set/Lost/Reopened, repeated saves, backward
  moves, and the Closed→Nurturing loop **cannot** create a duplicate or spurious
  conversion (proven by unit tests on the claim/eligibility logic).
- Outbox rows are delivered to Data Manager within minutes with correct milestone
  time, transaction id, hashed identifiers, raw click ids, and the chosen consent
  value; failures are visible + retryable; nothing is silently dropped.
- Google Ads shows each imported action separately; the CRM remains the
  authoritative pipeline. "Valid Seller Lead" is ready to become Primary once the
  owner confirms imports look right.
- Typecheck clean, build compiles, `npm test` green (new pure-logic suites added),
  and the owner's first-connection `validateOnly` round-trip succeeds.
