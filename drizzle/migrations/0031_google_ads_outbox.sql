-- Google Ads lead-stage offline-conversion outbox. One row per qualifying
-- first-time CRM milestone (Nurturing / Signed / Closed); a background worker
-- delivers it to Google's Data Manager API. The UNIQUE(lead_id, milestone)
-- index is the ONLY once-only guard — enqueue on every entry, ON CONFLICT DO
-- NOTHING makes a backward-then-forward re-entry a no-op (design §5.2). No new
-- leads columns, no atomic claims, no transactions. Also a single-row token
-- cache mirroring realcomp_tokens / ms_graph_tokens. Hand-authored, idempotent.

CREATE TABLE IF NOT EXISTS "google_ads_conversion_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "source_event_id" integer,
  "milestone" varchar(40) NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "event_source" varchar(16) NOT NULL DEFAULT 'OTHER',
  "conversion_action_id" varchar(120),
  "transaction_id" varchar(120) NOT NULL,
  "conversion_value" numeric,
  "currency" char(3),
  "export_status" varchar(16) NOT NULL DEFAULT 'pending',
  "export_attempts" integer NOT NULL DEFAULT 0,
  "google_request_id" varchar(120),
  "submitted_at" timestamp,
  "next_retry_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Once-only guard: at most one outbox row per (lead, milestone).
CREATE UNIQUE INDEX IF NOT EXISTS "gaco_lead_milestone_uidx" ON "google_ads_conversion_outbox" ("lead_id", "milestone");--> statement-breakpoint
-- Google-side dedup key, also unique on our side.
CREATE UNIQUE INDEX IF NOT EXISTS "gaco_transaction_uidx" ON "google_ads_conversion_outbox" ("transaction_id");--> statement-breakpoint
-- Worker scan: pending / retryable rows that are due.
CREATE INDEX IF NOT EXISTS "gaco_status_retry_idx" ON "google_ads_conversion_outbox" ("export_status", "next_retry_at");--> statement-breakpoint
-- Reconciliation by Google's request id.
CREATE INDEX IF NOT EXISTS "gaco_request_id_idx" ON "google_ads_conversion_outbox" ("google_request_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_ads_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider" varchar(50) NOT NULL DEFAULT 'google_datamanager',
  "access_token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_ads_tokens_provider_uidx" ON "google_ads_tokens" ("provider");
