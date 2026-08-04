-- Launch reset: the queue starts empty and reflects genuine opt-in order.
--
-- WHY. Migration 0037 backfilled `queue_joined_at` for anyone who was
-- `is_available = true` — but at that point availability still defaulted to
-- TRUE (0038 changed it afterwards). So agents who never opted into anything
-- were granted permanent queue membership, and their join ORDER came from
-- `created_at` rather than from any decision they made. The rotation has been
-- ordered by account-creation date ever since.
--
-- The one-time +50 starting credit has the same problem from the other side:
-- `starting_credit_granted_at` was already spent by those legacy activations,
-- so an agent opting in for real now gets no head start and only one slot.
--
-- This clears both, so the first GENUINE opt-in — the agent turning their own
-- switch on, having accepted the referral terms (0043) — is what joins them to
-- the queue, fixes their place in line, and grants the +50 (three slots).
--
-- Score history is wiped too: everything in agent_score_log predates launch and
-- is test-era activity, so leaving it would start the roster at uneven scores
-- and uneven slot counts. Every agent begins identical.
--
-- The persisted rotation in agent_queue is emptied as well. lib/queue.ts would
-- reconcile it away on the next read anyway (membership is now empty), but
-- leaving a stale list here would make the admin page show a phantom rotation
-- until something triggered that reconcile.
--
-- DESTRUCTIVE and deliberately so — this is the pre-launch clean slate. It is
-- idempotent in effect but NOT reversible: the score log is deleted outright.
--
-- Hand-authored — never `drizzle-kit generate` (lessons-learned §1).

DELETE FROM "agent_score_log";
--> statement-breakpoint
-- Back to the column defaults: lifetime/score are the 50-point tier baseline,
-- the rolling/ytd/monthly tracks start at zero.
UPDATE "agents"
   SET "score" = 50,
       "score_lifetime" = 50,
       "score_ytd" = 0,
       "score_monthly" = 0,
       "score_rolling_365" = 0,
       "starting_credit_granted_at" = NULL,
       "queue_joined_at" = NULL,
       "updated_at" = now();
--> statement-breakpoint
-- Empty rotation. Membership is now empty, so this is the honest starting state.
UPDATE "agent_queue" SET "rotation_list" = '[]', "pointer" = 0, "last_rebuilt" = now();
