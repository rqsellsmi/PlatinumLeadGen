# P0 Remediation — Independent Code Review Findings

**Branch reviewed:** `claude/p0-repairs-ci-setup-dwhq25`
**Date:** 2026-07-29
**Reviewer:** Claude (independent review against the decision log D1–D23 + the code-review revisions), commissioned by the owner before the code team's review.
**Method:** diff read of all 88 changed files (~4,600 lines) plus four focused deep-dives (identity/report-token, conversions/abuse, coverage/phone, credentials/queue/migrations), with the highest-risk wiring traced end-to-end.

---

## Verdict

**High-quality implementation.** The most important change — the D3 cross-lead identity fix — is **clean, with no leak paths found**, and the large majority of the branch verified correct against the decisions. Three issues surfaced; **one should be fixed before P0.8 is considered complete.**

| # | Severity | Area | Fix before merge? |
|---|---|---|---|
| 1 | 🔴 High (bounded) | Plaintext magic-link tokens on the offer-email channel | Yes |
| 2 | 🟠 Medium | Out-of-state gate only covers the public form | Now or fast-follow |
| 3 | 🟡 Low | Valuation auto-linked on any contact match (data integrity) | Hardening |

---

## Issues

### 1. 🔴 Plaintext magic-link tokens on the offer-email channel — `lib/autoOffer.ts:297-304`

`dispatchOfferEmail` still uses the pre-D6 path: it reads the raw `magic_link_token` column and, when it is missing or expired, generates a fresh **plaintext** token and writes it straight to the DB:

```ts
let token = agent.magicLinkToken;
if (!token || isTokenExpired(agent.magicLinkExpiresAt, now)) {
  token = generateMagicLinkToken();
  await db.update(agents).set({ magicLinkToken: token, ... })
```

Every other mint site was migrated to `issueMagicLinkToken()` (hash-at-rest, clears the raw column) — this one was missed, and it is the **primary channel agents log in through.** The login route still accepts the raw column as a fallback (`or(eq(magicLinkTokenHash,…), eq(magicLinkToken, …))`), so these are valid 14-day logins **stored in cleartext**, re-introducing the exact exposure P0.8 / migration `0036` set out to eliminate.

Blast radius is bounded by the compensating controls that *did* land (rotation-on-use, `session_version` revocation, 14-day TTL), but it contradicts the D6 hash-at-rest guarantee on the main channel.

**Fix:** have `dispatchOfferEmail` call `issueMagicLinkToken(agent.id)` and email the returned raw value, rather than writing the plaintext column.

### 2. 🟠 Out-of-state gate only covers the public form — `app/admin/leads/new/*`, `app/api/webhooks/lead/route.ts`

The `address_components` fix populates `property_state` for the public Places form (gated correctly). But `decideCoverage` uses `property_state` if present, else string-parses the formatted address, else returns `unknown` → routes normally. There is **no coords→state reverse-geocode fallback** (documented as deferred in `lib/coverage.ts`).

- **Admin manual-lead entry** (`app/admin/leads/new/{page.tsx,actions.ts}`) captures **no state field and no coordinates** — leads are always `property_state = NULL`, so the gate depends entirely on the address string matching a strict comma format (`", XX 12345"`). A plausible entry like `500 Oak, Cleveland OH 44101` does not match → `unknown` → the out-of-state lead is **auto-offered to a Michigan agent.** This path exists specifically for offline/phone leads.
- **Webhook leads** leave `propertyState` optional; when omitted, same string-parse dependency (stored `lat/lng` is never consulted).

Not a paid-funnel blocker (the public funnel is gated). **Fix:** add a state field to admin lead entry and require/derive state on the webhook, or implement the deferred coords reverse-geocode fallback (admin leads store no coords, so they need the form field regardless).

### 3. 🟡 Valuation auto-linked on any contact match — `app/api/leads/submit/route.ts:328` (data integrity, not disclosure)

On a contact match the route calls `linkValuationToLead(input.valuationToken, existing.id)`, attaching the just-run valuation to the matched lead. On a **phone-only** match, someone who knows a victim's phone could attach *their own* address/valuation onto the victim's record — record pollution, **not** a disclosure leak (nothing is returned to the browser). This is the "internal auto-merge must be conservative" caveat from **D3 REVISED**.

**Fix:** link only on a strong match (email *and* phone), or hold the run as a flagged reconciliation candidate rather than auto-linking on a weak (phone-only) match.

### Minor cleanups (non-blocking)

- `lib/leadDedup.ts:48` `findLeadByAddress` is now dead code; its header still describes "Layer 2: cross-session address dedup" as active. Delete it so it can't be accidentally rewired.
- `lib/roundRobin.ts:buildRotationList` (the interleave/"weave" path) is unreachable from the live routing path — remove to avoid confusion with the new append-by-join-order model.
- `lib/statusUpdates.ts` enqueue-block comment still reads "Nurturing / Signed / Closed" and omits `appointment_set` (stale comment; behavior is correct).

---

## Verified correct (against the decisions)

**P0.1 / D3 (identity):** address-only Layer 2 dedup removed; a contact match returns a PII-free `existingRecord` response (no id/token/PII, doesn't reveal which field matched); report links go **only** to the on-file email, so a phone-only match cannot be hijacked by an attacker's typed email; token opaque/expiring/revocable and gates `getReportContext`; new submissions mint their own token; regression tests are real (`tests/leadIdentity.test.ts`, `tests/reportToken.test.ts`).

**P0.2 / P0.3 / D4 / D5 (analytics, appointments, abuse):** raw email/phone removed from the GTM dataLayer (enhanced conversions moved to gtag's hashed `user_data` channel); `appointment_set` genuinely wired as a **separate, bidding-quality** conversion with its own action id and a live enqueue path from the agent status flow (not a test-only change); `appointment_requested` retained as Secondary; appointments authorize via the report-token capability (raw `leadId` no longer trusted); honeypot + minimum-completion-time added on all public writes and biased flag-over-block (false-positive-safe); conversion dedup via `UNIQUE(lead_id, milestone)` + transaction id, client conversions kept in parallel.

**P0.8 / D6 / D7 (credentials, queue):** offer-accept grants **no** portal session (D6 part 2); magic link hashed at rest with 14-day TTL and `session_version` revocation checked in `getCurrentAgent()`; "request a fresh link" path with no user enumeration; `is_available` defaults false (opt-in); "Departed" = `isActive=false` with real session revocation on deactivate; leaderboard filters active + points-in-window; Launch button one-time-guarded by `launch_invites_sent_at`, single-use per-agent invites to active passwordless agents; **queue invariants all tested** (`tests/queueInvariants.test.ts`: toggling availability never improves position, served slot → back, membership survives pause, top-slot stable when others join, on-surface skip distinct from distance-skip). *(Except issue #1.)*

**P0.4 / P0.7 / D22 (phone, social proof, coverage):** office resolved by location with a real office-of-record fallback and fail-closed alert (no fake 555); `/ads/[slug]` removed with `permanent` 301s to `/sell`; "homes sold" driven by real `market_stats`/IDX and `socialProofCount` renamed `valuationRequestsCount` (internal-only); radius clamped to 250mi with a broad-area warning; out-of-state full leads route to admin even within 250mi.

**Infra:** migrations `0033–0038` idempotent (including the guarded `RENAME COLUMN` in `0034`), `_journal.json` contiguous, `schema.ts` in sync with every new column; `isTest` auto-set from the test-contact allowlist and excluded at routing, scoring/leaderboard (structural — a test lead never generates a `lead_offer`), agent notifications, and Google Ads exports; CI (`.github/workflows/ci.yml`) runs `npm ci → typecheck → test → build` on push + PR with no secrets, matching D18 REVISED.

---

## Recommendation

Proceed to the code team's review **with issue #1 fixed first** (it partially defeats P0.8 on the primary login channel). Issue #2 should be closed now or fast-followed depending on whether the webhook/admin lead sources are active at launch; issue #3 is a small hardening. The risky core — identity, credentials, and the queue rewrite — is well-built and well-tested; the gaps are at the edges.
