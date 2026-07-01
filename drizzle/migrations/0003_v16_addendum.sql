-- v1.6 Addendum (Sections A, C, D, E, G, H).
-- Hand-authored migration: drizzle-kit's interactive generator can't run in CI,
-- and the repo's snapshot chain (0002) is intentionally SQL-only. Idempotent.

-- ---------------------------------------------------------------------------
-- Score reasons: stale penalties + deletion reversal (§E.5 / §K.3)
-- ---------------------------------------------------------------------------
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'stale_48h';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'stale_7day';--> statement-breakpoint
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'lead_deleted_reversal';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Agents: new agents start at score 50 (§E.2 / §J)
-- ---------------------------------------------------------------------------
ALTER TABLE "agents" ALTER COLUMN "score" SET DEFAULT 50;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Locations: school district for closings → per-location stats matching (§A.2)
-- ---------------------------------------------------------------------------
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "school_district" varchar(200);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Upload batches + closings (§A.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "upload_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_role" varchar(20) NOT NULL,
	"file_name" varchar(500),
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"rows_errored" integer DEFAULT 0 NOT NULL,
	"earliest_close_date" timestamp,
	"latest_close_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"mls_number" varchar(50),
	"agent_role" varchar(20) NOT NULL,
	"close_date" timestamp NOT NULL,
	"list_price" integer,
	"sale_price" integer NOT NULL,
	"days_on_market" integer,
	"address" varchar(500) NOT NULL,
	"city" varchar(100),
	"state" varchar(10) DEFAULT 'MI' NOT NULL,
	"zip_code" varchar(20),
	"property_type" varchar(100) DEFAULT 'Single Family' NOT NULL,
	"agent_name" varchar(200),
	"school_district" varchar(200),
	"percent_of_list_price" real,
	"upload_batch_id" integer NOT NULL REFERENCES "upload_batches"("id") ON DELETE cascade,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "closings_mls_role_idx" ON "closings" ("mls_number","agent_role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "closings_district_idx" ON "closings" ("school_district");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "closings_close_date_idx" ON "closings" ("close_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "closings_batch_idx" ON "closings" ("upload_batch_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Home page metrics: full recompute set (§A.4)
-- ---------------------------------------------------------------------------
ALTER TABLE "home_page_metrics" ADD COLUMN IF NOT EXISTS "homes_sold" integer;--> statement-breakpoint
ALTER TABLE "home_page_metrics" ADD COLUMN IF NOT EXISTS "avg_percent_of_list" integer;--> statement-breakpoint
ALTER TABLE "home_page_metrics" ADD COLUMN IF NOT EXISTS "pct_above_list_price" integer;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Recent sales: auto-population from closings (§A.4)
-- ---------------------------------------------------------------------------
ALTER TABLE "recent_sales" ADD COLUMN IF NOT EXISTS "is_auto_populated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recent_sales" ADD COLUMN IF NOT EXISTS "closing_id" integer REFERENCES "closings"("id") ON DELETE set null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Leads: attribution (§C.2) + normalized address for dedup (§D.3)
-- ---------------------------------------------------------------------------
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_source" varchar(200);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_medium" varchar(200);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_campaign" varchar(200);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_content" varchar(200);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_term" varchar(200);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "gclid" varchar(500);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "gbraid" varchar(500);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "wbraid" varchar(500);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "referrer" varchar(1000);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "landing_page_url" varchar(1000);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "device_type" varchar(20);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "normalized_address" varchar(500);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_email_idx" ON "leads" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_normalized_addr_idx" ON "leads" ("normalized_address");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Appointment requests: attribution (§C.2)
-- ---------------------------------------------------------------------------
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "utm_source" varchar(200);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "utm_medium" varchar(200);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "utm_campaign" varchar(200);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "utm_content" varchar(200);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "utm_term" varchar(200);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "gclid" varchar(500);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "gbraid" varchar(500);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "wbraid" varchar(500);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "referrer" varchar(1000);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "landing_page_url" varchar(1000);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "device_type" varchar(20);--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Agent score log: negation on lead delete (§E.7 / §K.3)
-- ---------------------------------------------------------------------------
ALTER TABLE "agent_score_log" ADD COLUMN IF NOT EXISTS "is_negated" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "agent_score_log" ADD COLUMN IF NOT EXISTS "negated_reason" varchar(500);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Lead events: lifecycle timeline (§D.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lead_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE cascade,
	"event_type" varchar(100) NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_lead_idx" ON "lead_events" ("lead_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Agent queue: persisted weighted rotation (§G.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "agent_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"rotation_list" text NOT NULL,
	"pointer" integer DEFAULT 0 NOT NULL,
	"last_rebuilt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- API usage logs: enriched columns for the dashboard (§H / §K.7)
-- ---------------------------------------------------------------------------
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "service" varchar(50);--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "property_address" varchar(500);--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "estimated_value" integer;--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "price_range_low" integer;--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "price_range_high" integer;--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "success" boolean;--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD COLUMN IF NOT EXISTS "response_time_ms" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_service_idx" ON "api_usage_logs" ("service");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_created_idx" ON "api_usage_logs" ("created_at");
