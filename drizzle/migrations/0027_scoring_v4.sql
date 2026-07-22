-- Agent Scoring v4 (Seller Track). Adds the new statuses, the four milestone
-- once-guards, the unified update-clock fields, and the reactivation counter.
-- New enum values are NOT used in this migration (the data backfill that USES
-- them is 0028) so they can be added here safely. Old enum members
-- (contacted/qualified/working, stale_*) are left in place — Postgres cannot
-- drop enum values — but the app stops writing them. Hand-authored, idempotent.

ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'connected';--> statement-breakpoint
ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'nurturing';--> statement-breakpoint
ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'appointment_set';--> statement-breakpoint
ALTER TYPE "lead_status" ADD VALUE IF NOT EXISTS 'signed';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'fast_engagement';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'milestone_appointment_set';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'milestone_signed';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'missed_update_checkin';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "update_deadline" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "first_engagement_logged" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "milestone_attempted_contact" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "milestone_connected" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "milestone_appointment_set" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "milestone_signed" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reactivation_count" integer NOT NULL DEFAULT 0;
