-- Rolling routing-score window changed from 90 to 365 days: rename the column.
-- Idempotent: rename only when the old column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'score_rolling_90d'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'score_rolling_365'
  ) THEN
    ALTER TABLE "agents" RENAME COLUMN "score_rolling_90d" TO "score_rolling_365";
  END IF;
END $$;
--> statement-breakpoint
-- Safety net for a fresh DB where the old column never existed.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "score_rolling_365" real NOT NULL DEFAULT 0;
