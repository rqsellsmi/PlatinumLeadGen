# Google Ads Lead-Stage Offline Conversion Tracking — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-24-google-ads-lead-stage-tracking-design.md`
**Branch:** `feature/google-ads-tracking` (off `refinements-v1`)
**Approach:** phased; `npm run typecheck` + `npm test` green after **every** phase
(repo rule). Pure logic (hashing, transaction-id, eligibility, nurturing-eligibility
/ Closed-safeguard, request-body builder) is unit-tested before the DB/worker/API
layers wire on top. Build + full test only at the finish.

**Blocked on sign-off:** Open Decisions D1–D4 + the D11 confirmation
(design §13). D5–D10 are locked and Phases 1–3 can start on those alone; the
worker/API phases (4–6) need D2 (auth) and the owner's Google Cloud + Ads setup
(customer id, three action ids). Nothing Google-live is runnable in this sandbox —
that's the owner's first-connection step, same boundary as IDX/Telnyx/Places.

---

## Phase 0 — Sign-off & Google-side prerequisites (no code)
- Confirm D1 (consent), D2 (auth), D3 (form conversion), D4 (scope), D11
  (eligibility + the three action ids + customer id).
- Owner/admin, in Google Cloud + Google Ads (vendor §7/§8): enable the Data
  Manager API, create the service account / credential (per D2), grant it Google
  Ads access, request scope `https://www.googleapis.com/auth/datamanager`, create
  the three offline conversion actions (Count = **One**), and hand back the
  customer id + three action ids. These block Phases 4–6, not 1–3.

## Phase 1 — Schema & milestone guards (migration `0031`, pure helpers)
- `drizzle/migrations/0031_google_ads_outbox.sql` (idempotent; `IF NOT EXISTS`):
  - `CREATE TABLE google_ads_conversion_outbox` with all columns + constraints/
    indexes from design §6.1.
  - `ALTER TABLE leads ADD COLUMN IF NOT EXISTS milestone_nurturing boolean NOT NULL DEFAULT false`,
    same for `milestone_closed`.
  - (Only if D1 = explicit capture: the two `*_consent` columns — otherwise skip.)
- `drizzle/schema.ts`: add the `googleAdsConversionOutbox` table; add
  `milestoneNurturing`/`milestoneClosed` to `leads`; register `0031` in
  `meta/_journal.json`.
- `lib/scoring.ts`: extend `LeadMilestone` union with `'nurturing' | 'closed'` and
  add the two `case`s to `claimLeadMilestone`.
- **Single migration file is fine** — no `ADD VALUE` (contrast §19); columns only.
- Tests: none new yet (schema). `typecheck` green.

## Phase 2 — Pure logic: hashing, transaction-id, eligibility, mapping (unit-tested)
- `lib/googleAdsHash.ts`: `normalizeEmail` (trim/lowercase; gmail/googlemail dot-
  strip), `normalizePhoneE164`, `sha256Hex` (UTF-8, lowercase 64-hex, no re-hash of
  an existing digest). **Relative imports only** (vitest `@/` trap, §17).
- `lib/googleAdsOutbox.ts` (pure parts): `transactionIdFor(leadId, milestone)`,
  `milestoneToActionId(milestone, config)`, `deriveEventSource(channel)`,
  `isExportEligible(lead, allowlist)`, and `buildIngestRequest(...)` (returns the
  Data Manager JSON shape — no network).
- `lib/googleAdsConfig.ts`: env getters (`||` fallback), the eligibility allowlist
  constant (D11).
- Tests (`tests/googleAdsHash.test.ts`, `tests/googleAdsOutbox.test.ts`): known
  hash vectors (QA #11), transaction-id determinism (#4/#7/#8), eligibility
  filter, `event_source` derivation, RFC-3339 formatting, request-body shape
  (#14 offline), and the **nurturing-eligibility + Closed-safeguard predicate**
  (#6/#7/#10) as a pure function `shouldEnqueueValidLead({claimedNurturing, milestoneSigned, milestoneClosed})`.

## Phase 3 — Enqueue hook in the status-change core
- `lib/statusUpdates.ts recordStatusUpdate`: after the timeline write, inside the
  `!backward` branch, alongside the v4 scoring block, call a new
  `enqueueGoogleAdsConversion(...)` in `lib/googleAdsOutbox.ts`:
  - `signed`: reuse the **already-computed** `milestone_signed` claim result from
    the scoring block (don't double-claim) → enqueue `listing_signed`.
  - `closed`: `claimLeadMilestone(leadId,'closed')` → enqueue `closed`.
  - `nurturing`: `claimLeadMilestone(leadId,'nurturing')` AND read
    `milestoneSigned`/`milestoneClosed` false → enqueue `valid_seller_lead`.
  - `source_event_id` = the `lead_events` id just written (thread it out of
    `logLeadEvent`, which currently returns void — small refactor to return the id).
  - Wrap in `try/catch` + `console.error` (best-effort, never throws — matches the
    scoring block).
  - `event_source` from the update channel (SMS ⇒ PHONE, portal ⇒ WEB, else OTHER).
- Insert is `.onConflictDoNothing()` on `(lead_id, milestone)`.
- Tests: extend `tests/statusUpdates`-level coverage where DB-free; the DB-touching
  enqueue is covered by the pure predicate in Phase 2 (the repo can't run a live DB
  in-suite). `typecheck` + `npm test` green.

## Phase 4 — Data Manager API client + auth (needs D2 + Phase 0 creds)
- `lib/googleAdsClient.ts`: token acquisition per D2 (service-account → short-lived
  access token, cached in `google_ads_tokens` with self-heal-on-401, mirroring
  `lib/realcomp.ts`), and `ingestEvents(request, {validateOnly})` +
  `retrieveRequestStatus(requestId)`. Per-request `AbortController` timeout +
  retryable-error classification (5xx/429/408/network → backoff), the same
  hard-won shape as the Realcomp fetch layer (§13a). **Never logs** the payload.
- `.env.example`: document `GOOGLE_ADS_CUSTOMER_ID`, the three action-id vars, the
  auth vars, `GOOGLE_ADS_VALIDATE_ONLY`.
- Tests: token-cache/refresh logic where pure; the live call is owner-verified.

## Phase 5 — Worker route + schedule
- `app/api/cron/google-ads-dispatch/route.ts` (model: `dispatch-queued-offers`):
  `x-cron-secret` gate, `runtime=nodejs`, `dynamic=force-dynamic`. Select due
  `pending`/retryable-`error` outbox rows, join `leads`, apply `is_deleted=false` +
  eligibility, build+send one event each, persist `google_request_id`/status/
  attempts/`next_retry_at`/`last_error`; mark ineligible rows `ineligible`.
- A second pass (same route or a sibling) runs `retrieveRequestStatus` on
  `submitted` rows → `accepted`/`processing`/`error`.
- `.github/workflows/cron.yml`: add a "Dispatch Google Ads conversions" curl step
  (same `x-cron-secret` pattern).
- `.github/workflows/scheduled-daily.yml`: add a **daily reconciliation** ping that
  re-drives stale `pending`/`submitted`/`processing`/retryable-`error` rows.
- Set the new secrets in **both** Vercel and GitHub Actions (§9; the "set it in
  every environment that reads it" trap, §15).

## Phase 6 — Admin visibility (small, optional in Phase 1)
- A read-only slice for the outbox (counts by `export_status`, recent errors) —
  either a compact card on an existing admin page or a small `/admin/google-ads`
  view. Surfaces `last_error` so a human can act (never-swallow-external-errors,
  §11). Deferrable if D4 wants the thinnest Phase 1.

## Phase 7 — Docs + final gate
- Update `docs/current-state.md` (new §4.x: server-side offline conversions, the
  outbox, the two new milestone guards, the worker + schedule, the new env).
- Add `docs/lessons-learned.md` section + a `docs/session-summary.md` entry.
- Note the migration-apply + env-set owner steps (every Neon branch; both envs).
- Final gate: typecheck clean, build compiles, `npm test` green.

---

## Owner setup checklist (mirrors vendor §12, made repo-specific)
- [ ] Apply migration **0031** on every Neon branch the app + GitHub Actions use.
- [ ] Create the three Google Ads offline conversion actions (Count = One); hand
      back their ids + the customer id.
- [ ] Enable the Data Manager API; provision the auth credential (per D2); grant
      Google Ads access; request the `datamanager` scope.
- [ ] Set `GOOGLE_ADS_*` secrets in **Vercel** and **GitHub Actions**
      (`GOOGLE_ADS_VALIDATE_ONLY=1` during QA).
- [ ] Verify GCLID/GBRAID/WBRAID + UTMs populate through every live form path;
      measure null-rate by paid campaign.
- [ ] Run the QA plan (§12) with test leads; confirm `validateOnly` round-trip,
      request-status retrieval, and per-action reporting in Google Ads.
- [ ] Keep imported actions **Secondary** during validation; promote "Valid Seller
      Lead" to Primary (and form → Secondary) only once imports look right.
- [ ] Decide/confirm the consent posture (D1) with privacy counsel before go-live.

## Risks / watch-items (from lessons-learned)
- **Google's API differs from its docs** (IDX §12b, Telnyx §17): validate every
  field/enum against a live `validateOnly` call before trusting the mapping.
- **Persisted token can wedge on a bad mint** (§12d): build the on-401 self-heal
  when building the token cache, not after.
- **Empty GH-Actions secret = `""`** (§12d): use `||`, not `??`, on every getter.
- **Set the config in both the app and the cron environment** (§15): a correct DB
  proves the enqueue side, not that the worker's env is set.
- **Never swallow the API error** (§11): surface `last_error` for a human.
