-- One-time "starting credit" queue head start: the first time an agent flips
-- Available for leads, they get +50 to rolling-365 ONLY (queue slots), never
-- touching lifetime/ytd/monthly (leaderboards/tier unaffected). The flag below
-- guards against re-granting on later toggles; naturally decays out of the
-- rolling-365 window ~1 year after activation. Hand-authored, idempotent migration.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "starting_credit_granted_at" timestamp;--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'starting_credit';
