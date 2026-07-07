-- Agent Scoring v2 (spec v2): four score tracks, new score reason + lead status,
-- and lead lifecycle columns for Lost / stall / reopen.

-- Four score tracks. `score` is kept as a mirror of scoreLifetime.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "score_lifetime" real NOT NULL DEFAULT 50;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "score_ytd" real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "score_monthly" real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "score_rolling_90d" real NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Bootstrap the new tracks from the existing single score so cutover doesn't
-- reset anyone's routing frequency or leaderboard standing to zero.
UPDATE "agents" SET
  "score_lifetime" = "score",
  "score_ytd" = "score",
  "score_monthly" = "score",
  "score_rolling_90d" = "score";
--> statement-breakpoint
-- Seed a baseline log row per agent so the log-derived rolling-90d starts at the
-- bootstrapped value and decays naturally as this row ages past 90 days.
INSERT INTO "agent_score_log" ("agent_id", "delta", "reason", "note", "created_at")
SELECT "id", "score", 'manual_adjustment', 'Scoring v2 baseline (rolling-90d bootstrap)', now()
FROM "agents" WHERE "score" <> 0;
--> statement-breakpoint

-- New score reason + lead status values.
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'pipeline_stalled';--> statement-breakpoint
ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'reopened';--> statement-breakpoint

-- Lead lifecycle columns.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "contacted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_reason" varchar(40);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_at" timestamp;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "stall_penalty_at" timestamp;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp;
--> statement-breakpoint

-- Periodic-reset guards for the score-maintenance cron.
ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "score_monthly_reset_key" varchar(7);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "score_ytd_reset_key" varchar(4);
