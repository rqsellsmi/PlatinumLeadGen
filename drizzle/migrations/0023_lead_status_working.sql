-- New pipeline stages: Attempted Contact (pre-conversation) and Working
-- (post-qualified, pre-close), plus the pipeline_attempted score reason (+1.0).
-- Hand-authored, idempotent migration.

ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'attempted_contact';--> statement-breakpoint
ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'working';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'pipeline_attempted';
