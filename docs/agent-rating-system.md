# Agent Rating System

How each agent's **score** works: what it does, and exactly when points are added
or subtracted. Source of truth is `lib/scoring.ts` (deltas + `applyScore`) plus
the routes/crons that call it.

## The score in one paragraph

Every agent has a numeric **score**, starting at **50**, clamped to the range
**0–200**. Every change is written to the `agent_score_log` table (with the
delta, the reason, an optional note, and the related lead/offer), so the agent's
profile page shows a full history. The score is not cosmetic — it decides **how
often an agent is offered leads**.

## Why the score matters: routing frequency

Routing builds a rotation list and gives each agent a number of **slots** based
on their score (`lib/routing.ts` → `slotCountForScore`):

```
slots = clamp( 1 + floor(score / 15), 1, 5 )
```

| Score | Rotation slots | Relative lead frequency |
| ----- | -------------- | ----------------------- |
| 0–14  | 1 | baseline |
| 15–29 | 2 | 2× |
| 30–44 | 3 | 3× |
| 45–59 | 4 | 4× |
| 60+   | 5 | 5× (capped) |

So a higher score = more slots in the rotation = **more frequent lead offers**.
A new agent (score 50) gets 4 slots. Leads still only go to agents within the
proximity radius; the score sets frequency *among* eligible agents.

## Tiers (labels shown in admin)

From `lib/scoreTiers.ts` — display only:

| Score | Tier |
| ----- | ---- |
| ≥ 100 | Top Performer |
| ≥ 80  | Strong |
| ≥ 60  | Good Standing |
| ≥ 40  | Average |
| ≥ 20  | Needs Improvement |
| < 20  | At Risk |

## The point values

From `SCORE_DELTAS` in `lib/scoring.ts`:

| Reason | Delta | Meaning |
| ------ | ----- | ------- |
| `system_response_fast` | **+10** | Accepted an offer in under 15 min |
| (15–30 min tier) | **+7.65** | Accepted in 15–30 min (explicit delta, same "fast" reason) |
| `system_response_good` | **+5** | Accepted in 30–60 min |
| `system_response_slow` | **+2** | Accepted in 60 min–3 h |
| `system_no_response` | **−1.5** | Offer expired without being accepted |
| `system_decline` | **−3** | Declined an offer |
| `pipeline_contacted` | **+2** | Marked a lead **Contacted** |
| `fast_contact_bonus` | **+3** | Marked Contacted **within 24 h of accepting** |
| `pipeline_qualified` | **+2** | Marked a lead **Qualified** |
| `system_closing` | **+15** | Marked a lead **Closed** |
| `stale_48h` | **−1** | No first update 48 h after the offer was sent |
| `stale_7day` | **−1** | Still no update — recurs weekly |
| `manual_adjustment` | variable | Admin adjustment (requires a note) |
| `lead_deleted_reversal` | variable | Undo of a prior penalty when a lead is deleted |

Clamping note: if a change would push the score past 0 or 200, only the portion
that fits is applied — and the log records the amount **actually** applied.

## When each change fires (the lifecycle)

1. **Offer sent** → no score change.
2. **Agent accepts** (clicks the accept link) — `app/api/offer/[token]/route.ts`.
   Response-time score, measured from when the offer was **sent** to when it was
   accepted:
   - < 15 min → **+10**
   - 15–30 min → **+7.65**
   - 30–60 min → **+5**
   - 60 min–3 h → **+2**
   - (a queued offer with no send timestamp is treated as the top tier)
3. **Agent declines** → **−3**, and the lead is reassigned to the next agent.
4. **Offer expires** (3-hour acceptance window; the expire cron runs every 10
   min) → **−1.5**, and the lead is reassigned — `app/api/cron/expire-offers`.
5. **Agent marks Contacted** — `app/api/agent/status-update/route.ts`:
   **+2**, and **+3** more if it happens within 24 h of accepting the lead.
6. **Agent marks Qualified** → **+2**.
7. **Agent marks Closed** → **+15**.
8. **48 h with no first update** (accepted lead, offer sent > 48 h ago, no update
   yet) → **−1**, once — `app/api/cron/followup-check`.
9. **6-day nudge** → warning email only, **no** score change.
10. **7 days still stale** → **−1**, and the cycle resets so it recurs weekly
    until the agent posts an update.
11. **Admin manual adjustment** → any value the admin enters, with a required
    reason note — `app/admin/agents/[id]`.
12. **Admin deletes a lead** → reverses **only** the negative, not-yet-reversed
    penalties tied to that lead's still-open offers (e.g. an unaccepted offer's
    penalties). Penalties on already-resolved offers stay (a 3-day-old decline is
    not refunded) — `softDeleteLead`.

## About the "fast response bonus" you saw on a manual reassignment

This is expected behavior, not a bug — here's the mechanism:

- **Manually assigning a lead to a specific agent** (admin → reassign to a chosen
  agent) creates an offer that is already **accepted** and sets the lead's
  "accepted at" time to *now*. The assignment itself applies **no** score.
- But that assignment **starts the fast-contact clock**. If the agent (or you,
  acting for them) then marks the lead **Contacted within 24 h**, they earn
  `pipeline_contacted` **+2** *and* `fast_contact_bonus` **+3**. The "+3 Fast
  contact bonus" is almost certainly what you noticed.
- Separately, the other kind of reassignment — the **round-robin "reassign"**
  that re-routes the lead to the *next* agent — creates a fresh **offered** offer.
  If that agent accepts it quickly from the email, they get the response-time
  bonus (up to **+10**), because the clock starts when that new offer is sent.

In short: a direct admin assignment grants nothing by itself; any bonus comes
from **fast follow-up** (contacting within 24 h) or a **fast accept** on a
re-routed offer. Both are intended — the system rewards speed, and the clock
starts at the moment of (re)assignment.

## Where it all lives

| Concern | File |
| ------- | ---- |
| Deltas + `applyScore` (log + clamp) | `lib/scoring.ts` |
| Tier labels | `lib/scoreTiers.ts` |
| Score → routing slots | `lib/routing.ts` (`slotCountForScore`) |
| Accept / decline scoring | `app/api/offer/[token]/route.ts` |
| Expiry (no response) | `app/api/cron/expire-offers/route.ts` |
| Pipeline (contacted / qualified / closed / fast-contact) | `app/api/agent/status-update/route.ts` |
| Stale 48 h / 6-day warning / 7-day | `app/api/cron/followup-check/route.ts` |
| Manual adjustment | `app/admin/agents/[id]/actions.ts` |
| Lead-deletion reversal | `app/admin/leads/[id]/actions.ts` (`softDeleteLead`) |
| Score history UI | `components/agent/ScorePanel.tsx`, agent + admin profile pages |
