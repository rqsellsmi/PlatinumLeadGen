-- v1.5 additions (Sections 3, 16, 17, 18).
-- Hand-authored migration: drizzle-kit's interactive generator can't run in CI.

-- Offer status: manual reassignment outcome (Section 18.4)
ALTER TYPE "offer_status" ADD VALUE IF NOT EXISTS 'closed_manual';--> statement-breakpoint

-- Agent self-controlled availability (Section 16.2)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Locations: social proof + Google review display (Section 3.3 / 3.5)
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "social_proof_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "google_review_count" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "google_review_rating" real;--> statement-breakpoint

-- Leads: which page type captured the lead (Section 3.3)
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "page_variant" varchar(50);--> statement-breakpoint

-- Lead offers: generic responded-at for the offer history timeline (Section 17.2)
ALTER TABLE "lead_offers" ADD COLUMN IF NOT EXISTS "responded_at" timestamp;--> statement-breakpoint

-- Rate limits: reshape to the Neon background pattern (Section 8)
DROP TABLE IF EXISTS "rate_limits";--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" varchar(64) NOT NULL,
	"endpoint" varchar(100) NOT NULL,
	"window_start" timestamp NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_ip_endpoint_window_idx" ON "rate_limits" ("ip","endpoint","window_start");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" ("window_start");--> statement-breakpoint

-- MS Graph OAuth token persistence (Section 6.3)
CREATE TABLE IF NOT EXISTS "ms_graph_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_email" varchar(200) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text DEFAULT '' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ms_graph_tokens_account_email_unique" UNIQUE("account_email")
);--> statement-breakpoint

-- Email send log (Section 6.4) — replaces the Resend dashboard
CREATE TABLE IF NOT EXISTS "email_send_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"to_email" varchar(200) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"template_name" varchar(100) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"related_lead_id" integer,
	"related_agent_id" integer
);
