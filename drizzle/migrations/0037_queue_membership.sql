-- P0.8b — queue integrity (decision D7, D7 MODIFIED).
--
-- Fixes an availability-toggle gaming vector. Today `isAvailable` is applied as
-- a MEMBERSHIP filter at the SQL boundary, so pausing deletes every one of an
-- agent's slots from the persisted rotation and resuming re-weaves them at
-- evenly-spaced positions. A pause/resume cycle is therefore indistinguishable
-- from a fresh join — an agent who is deep in the queue can toggle availability
-- off and on and land back in the middle of the line, ahead of agents who
-- simply waited their turn.
--
-- The fix decouples the two ideas:
--   MEMBERSHIP  = has opted in at least once, and has not departed. Persists
--                 across pauses. `queue_joined_at` records when that happened.
--   AVAILABILITY = a runtime check at send time. An unavailable agent's slot is
--                 skipped and moved to the BACK when it surfaces — penalised
--                 only if a lead would actually have been served to them.
--
-- With membership stable, toggling availability can never move an agent
-- forward, so the gaming vector is removed by construction rather than by
-- policy.
--
-- `queue_joined_at` also carries the JOIN ORDER: the first agent to opt in
-- holds the top slot, the second the next, and so on. New agents append BEHIND
-- the existing line rather than weaving into the middle.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` (lessons-learned §1).

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "queue_joined_at" timestamp;

-- Backfill for agents already in the rotation. `starting_credit_granted_at` is
-- set the first time an agent ever went available (it guards the one-time
-- rolling-365 head start), so it is exactly the "first opted in" instant we
-- want. Anyone without it who is currently available joined at some unknown
-- earlier point; fall back to their creation time so the ordering is at least
-- stable and sensible rather than null.
UPDATE "agents"
   SET "queue_joined_at" = COALESCE("starting_credit_granted_at", "created_at")
 WHERE "queue_joined_at" IS NULL
   AND ("is_available" = true OR "starting_credit_granted_at" IS NOT NULL);
