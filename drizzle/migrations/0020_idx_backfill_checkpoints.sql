-- Resumable-backfill checkpoints. A failed initial-sync run leaves the newest
-- ModificationTimestamp it processed here (per job key), so the next run resumes
-- from that point instead of re-fetching everything. A successful run clears it.
CREATE TABLE IF NOT EXISTS "idx_backfill_checkpoints" (
  "id" serial PRIMARY KEY,
  "job_key" varchar(200) NOT NULL,
  "last_mod_ts" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_backfill_checkpoints_job_idx" ON "idx_backfill_checkpoints" ("job_key");
