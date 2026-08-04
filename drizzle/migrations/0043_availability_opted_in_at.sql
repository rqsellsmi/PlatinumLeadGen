-- Referral-terms acceptance record.
--
-- Turning on lead routing availability is how an agent accepts the 30% referral
-- back to RE/MAX Platinum (stated in the invite email and beside the toggle).
-- Until now that acceptance left no trace, so a disputed referral had nothing
-- to point at. This records WHEN the agent first accepted.
--
-- Deliberately NOT backfilled. Existing agents opted in before the terms were
-- ever shown to them, so stamping a date here would fabricate an acceptance
-- that never happened — worse than having no record. They stay NULL until they
-- next turn availability on themselves, having seen the terms.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` (lessons-learned §1).

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "availability_opted_in_at" timestamp;
