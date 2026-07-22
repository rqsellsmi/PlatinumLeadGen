# Agent Scoring v4 — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md`
**Branch:** `refinements-v1`
**Approach:** phased; typecheck + `npm test` green after every phase (repo rule).
Pure logic (transitions, Lost gating, point math, clock math) is unit-tested
before the DB/UI layers are wired on top.

---

## Phase 0 — Confirm the one open sub-decision
The §7 warning-email timing (pre-deadline warning re-pointed to `update_deadline`,
vs. no warning email). Default = keep a pre-deadline warning. No code.

## Phase 1 — Schema & constants (migrations 0027/0028, pure helpers)
- `0027_scoring_v4.sql`: `ALTER TYPE lead_status ADD VALUE IF NOT EXISTS` ×4
  (`connected`, `nurturing`, `appointment_set`, `signed`); `ALTER TYPE score_reason
  ADD VALUE` ×4 (`fast_engagement`, `milestone_appointment_set`, `milestone_signed`,
  `missed_update_checkin`); `ALTER TABLE leads ADD COLUMN IF NOT EXISTS` for
  `update_deadline`, `first_engagement_logged`, `milestone_*` (×4),
  `reactivation_count`.
- `0028_scoring_v4_backfill.sql` (separate file — new enum values usable only after
  0027 commits): `UPDATE leads SET status='connected' WHERE status='contacted'`;
  `…='nurturing' WHERE status IN ('qualified','working')`; seed `update_deadline`
  for live-but-unclocked leads (pre-launch: safe no-op if empty).
- `drizzle/schema.ts`: enum members + new columns; journal entries ×2.
- `lib/leadLifecycle.ts`: v4 status set, `leadStatusLabel`, `ALLOWED_TRANSITIONS`
  map, `LOST_REASONS_BY_ORIGIN`, `lostReasonsFor(originStatus, attemptedCount)`,
  `canMarkLost`, `isBackwardMove`. Pure.
- Tests: `tests/leadLifecycle.test.ts` — transitions (valid/invalid incl. new→
  connected, appt→nurturing back, new→signed rejected), Lost-by-origin, Lost A2 gate.

## Phase 2 — Point table + scoring core (pure-ish, unit-tested)
- `lib/scoring.ts`: update `SCORE_DELTAS` (accept 4/2/1; keep decline/expire/close);
  add `ScoreReason` members; `fastEngagementDelta(msSinceAccept)` (4/3/2/1/0);
  atomic `claimMilestone(leadId, key)` helper (starting-credit pattern) returning
  whether it awarded.
- `lib/offerActions.ts applyAccept`: accept bands → 4/3/2/1.
- Tests: `tests/v16.test.ts` (extend) — new SCORE_DELTAS, fast-engagement bands, the
  §4.4 worked example totals **50**.

## Phase 3 — statusUpdates rewrite (the heart)
- `lib/statusUpdates.ts recordStatusUpdate`: transition validation; on first
  Attempted/Connected → fast-engagement (once, from `accepted_at`); milestone award
  via `claimMilestone` (once-only); `update_deadline` reset per §5 (24h→7d→14d/back);
  backward-move handling (timeline event only, no counter/points); Lost origin-scoped
  reason validation, 0 points, `update_deadline=null`; `AGENT_SETTABLE_STATUSES` → v4.
- Tests: milestone pays once across nurturing↔appointment_set↔signed cycles;
  fast-engagement fires once; deadline transitions; Lost gating; backward move scores 0.

## Phase 4 — Unified update-clock cron
- `app/api/cron/followup-check/route.ts`: replace the 4 stale checks with the single
  `update_deadline` penalty (−2 `missed_update_checkin`, reset +7d/+14d). **Keep**
  the 48h escalation, weekly reminder, Thursday digest. Re-point the pre-deadline
  warning email to `update_deadline` (Phase 0 decision).
- `lib/autoOffer.ts`/accept path: set `update_deadline = accept + 24h`,
  `first_engagement_logged=false` on accept.

## Phase 5 — Reopen flow (D2/D4)
- `app/api/leads/submit/route.ts reopenLostLead`: `status=reopened`,
  `reactivation_count += 1`, restart clock, reset contacted/stall — **preserve**
  `milestone_*`. Confirm routing unchanged.

## Phase 6 — SMS vocabulary
- `lib/smsCommands.ts`: status phrases → connected/nurturing/appointment set/signed;
  drop qualified/working; Lost handled per origin (reason keyword or gated reply).
- Tests: `tests/smsCommands.test.ts` updated for the new vocabulary.

## Phase 7 — UI + labels
- `components/agent/StatusUpdateForm.tsx`: v4 statuses + origin-scoped Lost reasons.
- `components/agent/PipelineBoard.tsx`: v4 columns.
- `lib/scoreTiers.ts scoreReasonLabel` + `ScorePanel`: new reason labels.
- Admin: `app/admin/leads/page.tsx` (STATUSES filter), `[id]/page.tsx` +
  `[id]/actions.ts` (STATUSES), any other status-picker list.
- `reactivation_count` shown on the admin lead detail (reporting, D4).

## Phase 8 — Docs + final gate
- Rewrite `docs/agent-rating-system.md` to v4; update `docs/current-state.md`
  (§4.3 + data model + migration head), `docs/session-summary.md`,
  `docs/lessons-learned.md` (new §19).
- Full `npm test` + `npm run typecheck` + `npm run build`; update the test-count
  line in `current-state.md`.

---

## Owner steps (post-merge)
- Apply migrations **0027 + 0028** on every Neon branch (app + GitHub Actions).
- No env changes. No routing/slot changes.

## Risks / watch-items
- Postgres cannot drop enum values — old `contacted/qualified/working/stale_*`
  members stay vestigial; app must never write them (enforced by the transition map
  + updated `AGENT_SETTABLE_STATUSES`).
- ADD VALUE then USE-in-same-transaction is illegal → the data backfill is a
  separate migration (0028), run after 0027 commits.
- The accept economy shrinks (8→4); the slot formula is unchanged by decision, so a
  slot is now "worth more accepts." Flagged, not changed.
