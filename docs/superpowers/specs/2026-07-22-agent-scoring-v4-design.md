# Agent Rating & Lead Scoring — v4 (Seller Track) — Design Spec

**Date:** 2026-07-22
**Status:** Approved design — pending plan sign-off
**Branch:** `refinements-v1`
**Supersedes:** the Scoring v2 model in `docs/agent-rating-system.md`
**Author:** Requirement-gathering session (superpowers workflow)

---

## 1. Summary

Rebuild the agent point system around the new **Seller Track** status flow and
replace the three separate stale-lead penalties with **one unified update clock**.

Scope is **Seller Track only.** The schema drawing's blue boxes (Buyer Track) are
**placeholders** — not built here. The `leads.intent` field (migration 0026,
`seller`/`buyer`/`unknown`) already exists but does not branch any scoring in v4;
every lead is scored on the Seller Track for now.

The four-track aggregation stays exactly as today: `scoreLifetime` (tier),
`scoreYtd` / `scoreMonthly` (leaderboards), `scoreRolling365` (queue slots,
`slots = 1 + floor(sqrt(rolling365/10))`). v4 changes **which events fire and
their point values** — not the aggregation or the slot formula.

---

## 2. Decisions locked in requirement gathering

| # | Decision |
|---|---|
| D1 | **Pre-launch** — no careful data backfill. Old statuses are mapped over in a migration (`contacted→connected`, `qualified→nurturing`, `working→nurturing`); the new clock/anti-farm fields initialize from current state. |
| D2 | **Reopen-from-Lost** keeps a `reopened` status that **behaves like New Lead** (re-runs the track), BUT milestone points do **not** re-pay — `milestones_awarded` is sticky for the lead's lifetime. |
| D3 | **Backward moves** (Appointment Set→Nurturing, Signed→Nurturing) are a **manual agent action, no reason gating**. They are recorded only in the lead timeline (`lead_events`) — no counter, no points. |
| D4 | **`reactivation_count`** counts **Lost → Reopened** transitions (repurposed from backward moves). |
| D5 | **Notifications unchanged** — keep the warning / 48h broker escalation / weekly reminder / Thursday digest emails. Only the *point penalty* changes to the unified −2 clock. (See §7 for the one warning-timing mapping to confirm.) |

---

## 3. Status flow (Seller Track)

Enum `lead_status` (v4): `new`, `attempted_contact`, `connected`, `nurturing`,
`appointment_set`, `signed`, `closed`, `lost`, `reopened`.

Retired/renamed from v2: `contacted`→`connected`, `qualified`/`working`→
`nurturing` (data mapped in migration; the dead enum members remain in Postgres,
which cannot drop enum values, but are never written by the app).

Allowed transitions (enforced — see §6.3):

```
new / reopened  → attempted_contact | connected
attempted_contact → connected | lost(A/A2)
connected       → nurturing | lost(B)
nurturing       → appointment_set | lost(C)
appointment_set → signed | nurturing(back) | lost(C)
signed          → closed | nurturing(back) | lost(D)
closed          → (terminal)
lost            → (terminal for the agent; homeowner resubmit → reopened, §8)
```

- `new` → `connected` directly (skipping `attempted_contact`) is valid and scores
  identically once each status is reached.
- **Closed = Closed Won only.** A Signed deal that dies is **Lost** (Lost D), not
  "Closed Lost" — that status no longer exists.
- `reopened` has the **same allowed transitions as `new`.**

---

## 4. Point table (v4)

### 4.1 Offer response (in `lib/offerActions.ts applyAccept`)
| Event | v2 | **v4** |
|---|---|---|
| Accept < 15 min | +8 | **+4** |
| Accept 15–30 min | +6 | **+3** |
| Accept 30–60 min | +4 | **+2** |
| Accept 1–3 hrs | +1 | **+1** |
| Decline | −3 | **−3** |
| Offer expires | −4 | **−4** |

### 4.2 Fast-engagement bonus (NEW — `reason = fast_engagement`)
Fires **once per lead**, on whichever of Attempted Contact **or** Connected is
logged first, measured from `accepted_at`. Stacks with the milestone below.
| Accept → first log | Bonus |
|---|---|
| < 15 min | +4 |
| 15–30 min | +3 |
| 30–60 min | +2 |
| 1–3 hrs | +1 |
| > 3 hrs | +0 (and the §5 clock applies) |

### 4.3 Status milestones — once per lead, on first arrival only
| Status | Points | `score_reason` |
|---|---|---|
| Attempted Contact | +1 | `pipeline_attempted` (reuse) |
| Connected | +2 | `pipeline_contacted` (reuse, relabel "Connected") |
| Nurturing | +0 | (no score row) |
| Appointment Set | +4 | `milestone_appointment_set` (NEW) |
| Signed | +10 | `milestone_signed` (NEW) |
| Closed | +25 | `system_closing` (reuse) |
| Lost (any) | +0 | (no score row) |

`score_reason` enum: **add** `fast_engagement`, `milestone_appointment_set`,
`milestone_signed`, `missed_update_checkin`. **Retire** (leave vestigial, never
written): `fast_contact_bonus`, `pipeline_qualified`, `stale_48h`, `stale_7day`,
`pipeline_stalled`. Reused with new deltas: `system_response_*`.

### 4.4 Worked example (must total 50)
Accept 10 min (+4), Attempted Contact at 12 min (fast-engagement +4, milestone +1),
Connected 2 days later (+2, no second fast bonus), Nurturing (+0), Appointment Set
(+4), Signed (+10), Closed (+25) = **50**. Locked as a unit test.

---

## 5. Unified update clock (replaces `stale_48h` / `stale_7day` / `stalled_30day`)

New per-lead field `update_deadline timestamp`. One recurring penalty,
`−2 missed_update_checkin`, flat at every stage.

```
on accept_offer:          accepted_at = now; update_deadline = now + 24h; first_engagement_logged = false
on first Attempted/Connected log: fast-engagement bonus (§4.2); first_engagement_logged = true
on ANY status change/logged update (any stage before Signed): update_deadline = now + 7d
on reach Signed:          update_deadline = now + 14d
on logged update while Signed: update_deadline = now + 14d
on Signed → Nurturing (back): update_deadline = now + 7d
on reach Closed or Lost:  update_deadline = null   // clock stops permanently
cron (daily): for leads NOT in (closed, lost):
    if now > update_deadline:
        apply −2 (missed_update_checkin)
        update_deadline = now + (14d if status==signed else 7d)   // recurs, not every tick
```

Key behaviors: the **only hard deadline is the initial 24h** after accept; every
later deadline is 7d (14d once Signed) measured from the last update. A status
change **counts as an update** (no separate "log update" action). Penalty is flat
−2 everywhere. A lead can sit in Nurturing forever with 0 forward points and never
lose points, as long as an update lands every 7 days.

---

## 6. Lost — origin-scoped gating

`lost_reason` valid set depends on the **origin status** the agent is leaving:

| Origin | Group | Reasons | Gating |
|---|---|---|---|
| Attempted Contact | Lost A | `bad_number`, `wrong_number`, `email_bounced` | immediate |
| Attempted Contact | Lost A2 | `no_response_after_6` | after the **6th** logged Attempted Contact |
| Connected | Lost B | `already_listed_or_sold`, `just_looking`, `already_have_agent` | immediate |
| Nurturing / Appointment Set | Lost C | `stopped_responding`, `selected_another_agent`, `changed_plans` | immediate |
| Signed | Lost D | `listing_withdrawn`, `listing_expired`, `terminated_for_another_agent` | immediate |

All Lost transitions: **0 points, no clawback**, `update_deadline = null`. The
reason lists are seller-only (buyer reasons like financing/inspection/appraisal/
title live on the future Buyer Track and are **not** implemented). `other` is
dropped — the lists are exact per the schema drawing.

### 6.3 Transition + reason enforcement
`recordStatusUpdate` validates (a) the move is in the §3 allowed-transitions map
for the lead's current status, and (b) for a Lost move, the reason is in the
origin's list (and Lost A2 only if attempted-count ≥ 6). Invalid → rejected with a
typed reason (surfaced by the web form, the API, and SMS).

---

## 7. Notifications (D5) — one mapping to confirm at sign-off

Keep, unchanged in behavior: the **48h broker escalation** (accepted, no first
engagement in 48h), **weekly agent reminder**, **Thursday broker digest**.

The old stale **warning** emails (36h / 6-day) were anchored to `offerSentAt` /
`lastPenaltyAt`, which v4 retires. Proposed mapping: fire **one pre-deadline
warning email** when a lead is within ~24h of `update_deadline` and hasn't been
warned for the current cycle (reuse `staleWarningSentAt` for dedup). This keeps a
warning email in the flow (honoring "keep all emails") while anchoring it to the
new clock. **Confirm at plan sign-off** — the alternative is no warning email, just
the escalation/reminder/digest.

---

## 8. Reopen-from-Lost (D2)

`lib/.../reopenLostLead` (called from `/api/leads/submit` when a Lost lead's
contact resubmits): set `status = reopened`, `reactivation_count += 1`, restart the
clock (`update_deadline = now + 24h`, `first_engagement_logged = false`), reset
`contactedAt`/stall fields. **Do NOT** clear `milestones_awarded` — a reopened lead
walked back up to Signed/Closed does **not** re-pay those milestones. Routing:
same as today (same active agent, else fresh offer).

---

## 9. Data model changes

Migration **0027_scoring_v4** (schema) + **0028_scoring_v4_backfill** (data map),
split so newly-added enum values aren't used in the transaction that adds them.

| Field | Type | Purpose |
|---|---|---|
| `status` | enum (+4 values) | v4 status set |
| `update_deadline` | timestamp null | §5 cron clock |
| `first_engagement_logged` | boolean default false | §4.2 once-guard |
| `milestone_attempted_contact` | boolean default false | §4.3 once-guard (claimed atomically, starting-credit pattern) |
| `milestone_connected` | boolean default false | " |
| `milestone_appointment_set` | boolean default false | " |
| `milestone_signed` | boolean default false | " |
| `reactivation_count` | integer default 0 | Lost→Reopened count (D4) |
| `lost_reason` | varchar | now validated against the origin's list |

Representation note: four boolean `milestone_*` columns (not a JSON blob) so each
award is an atomic `UPDATE … WHERE milestone_x=false RETURNING id` claim — the same
concurrency-safe once-only guard proven by `grantStartingCreditIfFirstActivation`.
Retired columns `lastPenaltyAt` / `stallPenaltyAt` stay in the table, unused.

---

## 10. Surfaces touched

- `lib/scoring.ts` — SCORE_DELTAS, score_reason type, milestone/fast-engagement/
  missed-update helpers (atomic milestone claim).
- `lib/offerActions.ts` — accept tiers 4/3/2/1.
- `lib/statusUpdates.ts` — the core rewrite: transition validation, milestone
  once-only, fast-engagement, clock reset, backward moves, origin-scoped Lost.
- `lib/leadLifecycle.ts` — status set, labels, `LOST_REASONS_BY_ORIGIN`,
  transition map, `ATTEMPTED_CONTACTS_FOR_LOST` (=6).
- `app/api/cron/followup-check/route.ts` — unified clock; keep escalation/
  reminder/digest; re-point the warning email.
- `app/api/leads/submit/route.ts` — reopen flow (D2/D4).
- `lib/smsCommands.ts` — status vocabulary (connected/nurturing/appointment/
  signed; drop qualified/working); Lost-by-origin handling.
- UI — `components/agent/StatusUpdateForm.tsx`, `PipelineBoard.tsx`,
  `ScorePanel.tsx`/`scoreReasonLabel`; admin status pickers/filters
  (`app/admin/leads/*`, `AGENT_SETTABLE_STATUSES`).
- Docs — rewrite `docs/agent-rating-system.md` to v4; update `current-state.md`,
  `session-summary.md`, `lessons-learned.md`.

---

## 11. Non-goals
- Buyer Track scoring/statuses/reasons (placeholders only).
- Changing the four-track aggregation or the slot formula.
- Reason-gated backward moves (D3: manual, no reasons).
- Homeowner-facing status texts.
