# Agent Rating & Routing System — v2 (implemented)

Reflects the code after the Scoring v2 build (spec v2). Source of truth is
`lib/scoring.ts` (deltas + `applyScore`), `lib/routing.ts` (`slotCountForScore`),
`lib/leadLifecycle.ts`, and the routes/crons that call them.

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

## Point values (`SCORE_DELTAS`)

| Reason | Delta |
| --- | --- |
| Accept < 15 min | **+8** |
| Accept 15–30 min | **+6** (explicit) |
| Accept 30–60 min | **+4** |
| Accept 60 min–3h | **+1** |
| Decline | −3 |
| No response (offer expired) | **−4** |
| Contacted | +2 (+3 fast-contact bonus if within 24h of accept) |
| Qualified | +2 |
| Closed | **+25** |
| Stale 48h (no first update) | **−2** |
| Stale 7-day (recurring) | **−2** |
| Stalled 30-day (`pipeline_stalled`) | **−3**, recurs every 30d |
| Marked Lost | **0** (no direct penalty) |
| Manual adjustment / lead-deletion reversal | variable |

## Routing slots (uncapped)

```
slots = 1 + floor( sqrt( max(scoreRolling365, 0) / 10 ) )
```

No upper cap; each additional slot costs progressively more. Slot thresholds:
0→1, 10→2, 40→3, 90→4, 160→5, 250→6, … Leads still only route to agents within
the proximity radius; the slot count sets frequency among eligible agents.

## Lead lifecycle: Lost, stall, reopen (`lib/leadLifecycle.ts`)

- **Lost** — only allowed after a lead has been **Contacted** (tracked via
  `leads.contactedAt`), and requires a reason from a fixed set
  (`buyer_chose_other_agent`, `unresponsive`, `financing_fell_through`,
  `relisted_elsewhere`, `price_mismatch`, `other`). No score change. Reason +
  time stored on the lead and in the timeline for admin pattern review.
- **Stall** (`pipeline_stalled`) — a lead in **Qualified** with no status change /
  logged activity for 30 days incurs −3, recurring every 30 days (cron
  `followup-check`) until it's Closed or Lost. Marking Lost stops recurrence but
  does **not** reverse a stall penalty already posted — only a Lost *before* the
  30-day mark avoids it entirely.
- **Reopen** — the same contact submitting again on a **Lost** lead flips it to
  **Reopened** (distinct status), resets the stall clock and the Contacted
  precondition, and routes back to the same agent if still assigned + active,
  else routes fresh. Contacted/qualified points can be re-earned; the prior Lost
  episode stays on the log.

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
| Lost reasons + stall window | `lib/leadLifecycle.ts` |
| Accept/decline scoring | `app/api/offer/[token]/route.ts` |
| No-response (expiry) | `app/api/cron/expire-offers/route.ts` |
| Pipeline + Lost precondition/reason | `app/api/agent/status-update/route.ts` |
| Stale 48h / 7-day / 30-day stall | `app/api/cron/followup-check/route.ts` |
| Rolling recompute + monthly/YTD resets | `app/api/cron/score-maintenance/route.ts` |
| Reopen intake | `app/api/leads/submit/route.ts` |
| Manual adjustment | `app/admin/agents/[id]/actions.ts` |
| Lead-deletion reversal | `app/admin/leads/[id]/actions.ts` |
| Leaderboards | `app/agent/leaderboard/page.tsx` |
| Score history UI | `components/agent/ScorePanel.tsx` |
