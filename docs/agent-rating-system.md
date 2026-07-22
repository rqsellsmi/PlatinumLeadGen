# Agent Rating & Routing System — v4 (Seller Track, implemented)

Reflects the code after the Scoring v4 build. Full design +
decisions: `docs/superpowers/specs/2026-07-22-agent-scoring-v4-design.md`.
Source of truth is `lib/scoring.ts` (deltas + `applyScore` + `claimLeadMilestone`
+ `fastEngagementDelta`), `lib/routing.ts` (`slotCountForScore`),
`lib/leadLifecycle.ts` (statuses/transitions/Lost), `lib/statusUpdates.ts`
(the milestone/clock engine), and the routes/crons that call them.

**Scope: Seller Track.** The `leads.intent` field (seller/buyer/unknown) exists
but does not branch scoring yet — Buyer Track is a future, separate design.

## Four score tracks

`applyScore` writes one immutable row to `agent_score_log` and updates four
aggregate columns on the agent together:

| Track (`agents.*`) | Resets | Drives | Shown to agents |
| --- | --- | --- | --- |
| `scoreLifetime` | never | tier label | own Performance page only (private) |
| `scoreYtd` | Jan 1 | YTD leaderboard | public leaderboard |
| `scoreMonthly` | 1st of month | monthly leaderboard | public leaderboard |
| `scoreRolling365` | trailing 365-day sum | **routing slots only** | never |

- Lifetime/YTD/monthly are incremented on write and zeroed at their boundaries
  by `/api/cron/score-maintenance` (guarded by period keys so each fires once).
- Rolling-365 = sum of the agent's log deltas in the trailing 365 days; recomputed
  on every write and nightly by the maintenance cron so aging events decay out.
- The legacy `agents.score` column is kept as a mirror of `scoreLifetime`.
- **No clamp** — scores are uncapped in v2.

## Status flow (Seller Track)

`new`/`reopened` → `attempted_contact` → `connected` → `nurturing` →
`appointment_set` → `signed` → `closed`. `new`→`connected` may skip Attempted.
Backward `appointment_set`/`signed` → `nurturing` is allowed (deal/appointment
fell through, lead still active), manual and reason-free. `lost` is reachable
from attempted_contact/connected/nurturing/appointment_set/signed (not New).
Transitions enforced by `ALLOWED_TRANSITIONS` (`lib/leadLifecycle.ts`).

## Point values (`SCORE_DELTAS` + helpers)

Accept-speed (in `lib/offerActions.ts`):
| Reason | Delta |
| --- | --- |
| Accept < 15 min | **+4** |
| Accept 15–30 min | **+3** (explicit) |
| Accept 30–60 min | **+2** |
| Accept 1–3h | **+1** |
| Decline | −3 |
| No response (offer expired) | **−4** |

Fast-engagement bonus (`fastEngagementDelta`, once per lead, on the first
Attempted/Connected log, from `accepted_at`): **+4/+3/+2/+1/0** for
`<15 / 15–30 / 30–60 / 60–180 / >180` minutes. Stacks with the milestone below.

Status milestones (once per lead via atomic `claimLeadMilestone`; backward moves
pay nothing):
| Status | Delta | Reason |
| --- | --- | --- |
| Attempted Contact | +1 | `pipeline_attempted` |
| Connected | +2 | `pipeline_contacted` |
| Nurturing | 0 | — |
| Appointment Set | +4 | `milestone_appointment_set` |
| Signed | +10 | `milestone_signed` |
| Closed (Won) | +25 | `system_closing` |
| Lost (any) | 0 | — |

Update clock: **−2 `missed_update_checkin`** (see below). Manual adjustment /
lead-deletion reversal: variable. Full-lifecycle worked example totals **50**
(unit-tested in `tests/v16.test.ts`).

## Routing slots (uncapped)

```
slots = 1 + floor( sqrt( max(scoreRolling365, 0) / 10 ) )
```

No upper cap; each additional slot costs progressively more. Slot thresholds:
0→1, 10→2, 40→3, 90→4, 160→5, 250→6, … Leads still only route to agents within
the proximity radius; the slot count sets frequency among eligible agents.

## Unified update clock (`update_deadline`, cron `followup-check`)

Replaces the old stale_48h/stale_7day/stalled_30day rules with one recurring
check. On accept: `update_deadline = accept + 24h`. Any status change / logged
update: `+7 days` (`+14 days` once Signed). Reaching Closed/Lost: `null` (stops).
A status change **counts as an update** (no separate action). When overdue, the
cron applies a flat **−2** and re-arms the deadline (+7d / +14d Signed) so it
recurs once per cycle. A pre-deadline **warning email** fires ~24h out. The 48h
broker escalation, weekly agent reminder, and Thursday digest are unchanged.

A lead can sit in Nurturing indefinitely with no forward points and never lose
any, as long as an update lands every 7 days.

## Lost — origin-scoped reasons (`lib/leadLifecycle.ts`)

`lost` is one status; the valid reason list depends on the **origin** stage
(`lostReasonsForOrigin`). All Lost transitions score **0** (no penalty, no
clawback) and stop the clock.

| Origin | Reasons |
| --- | --- |
| Attempted Contact | bad number, wrong number, email bounced (+ "no response after 6" once ≥6 attempts) |
| Connected | already listed/sold, just looking, already have an agent |
| Nurturing / Appointment Set | stopped responding, selected another agent, changed plans |
| Signed | listing withdrawn, listing expired, terminated for another agent |

## Anti-farming + reactivation

- **Milestones pay once per lead** (guarded by `leads.milestone_*` booleans), so
  a lead cycled backward to Nurturing and forward again does not re-pay
  Connected/Appointment Set/Signed/Closed. The fast-engagement bonus is likewise
  once per lead (`first_engagement_logged`).
- **Reopen** — the same contact resubmitting a **Lost** lead flips it to
  **Reopened** (behaves like New — re-runs the track), increments
  `leads.reactivation_count`, restarts the 24h clock, and resets the fast-
  engagement guard. Milestones are **not** reset (no re-pay). Routes to the same
  active agent, else fresh.
- **`reactivation_count`** (Lost→Reopened count) is a **reporting stat only** —
  never a scoring input. Shown as a badge on the admin lead detail; 3+ is a
  pattern worth a look. Agent-driven backward moves are timeline entries only
  (no counter, no points).

## Tiers (display only, from `scoreLifetime`) — cohort-relative

Tiers are **percentiles of the active-agent cohort's lifetime score**, not fixed
thresholds (`lib/scoreTiers.ts`, cohort loaded by `lib/scoreTiersServer.ts`):

| Percentile | Tier |
| --- | --- |
| top 10% (≥90th) | Top Performer |
| 70–90th | Strong |
| 50–70th | Good Standing |
| 30–50th | Average |
| 10–30th | Needs Improvement |
| bottom 10% (<10th) | At Risk |

Rank uses the midrank (ties share a rank), so a fully-tied cohort lands mid-pack
rather than all bottoming out. Empty cohort → "Unranked".

## Leaderboards

`/agent/leaderboard` — public Monthly + YTD boards showing the top 20 plus the
viewing agent's own rank/percentile. Lifetime stays private on the agent's
Performance page.

## File map

| Concern | File |
| --- | --- |
| Deltas + `applyScore` (4 tracks, uncapped) | `lib/scoring.ts` |
| Rolling-365 → slots (uncapped) | `lib/routing.ts` (`slotCountForScore`) |
| Percentile tiers | `lib/scoreTiers.ts` + `lib/scoreTiersServer.ts` |
| Lost-reason roll-up (admin) | `app/admin/lost-reasons/page.tsx` |
| Statuses / transitions / origin Lost reasons | `lib/leadLifecycle.ts` |
| Milestones / fast-engagement / clock engine | `lib/statusUpdates.ts` |
| Accept scoring + accept clock start | `lib/offerActions.ts` |
| No-response (expiry) | `app/api/cron/expire-offers/route.ts` |
| Status-update entry point | `app/api/agent/status-update/route.ts` |
| Unified update clock (−2, warning) | `app/api/cron/followup-check/route.ts` |
| Rolling recompute + monthly/YTD resets | `app/api/cron/score-maintenance/route.ts` |
| Reopen intake | `app/api/leads/submit/route.ts` |
| Manual adjustment | `app/admin/agents/[id]/actions.ts` |
| Lead-deletion reversal | `app/admin/leads/[id]/actions.ts` |
| Leaderboards | `app/agent/leaderboard/page.tsx` |
| Score history UI | `components/agent/ScorePanel.tsx` |
