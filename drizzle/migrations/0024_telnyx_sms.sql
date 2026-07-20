-- Telnyx agent texting (Phase 1). Per-office sending number, agent opt-out,
-- and a message store mirroring email_send_log. Hand-authored, idempotent.

ALTER TABLE "offices" ADD COLUMN IF NOT EXISTS "telnyx_number" varchar(20);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "sms_opt_out" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "sms_opt_out_at" timestamp;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "direction" varchar(10) NOT NULL,
  "agent_id" integer,
  "lead_id" integer,
  "office_id" integer,
  "from_number" varchar(20) NOT NULL,
  "to_number" varchar(20) NOT NULL,
  "body" text NOT NULL,
  "kind" varchar(30) NOT NULL,
  "telnyx_message_id" varchar(100),
  "status" varchar(20) NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_agent_idx" ON "sms_messages" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_lead_idx" ON "sms_messages" ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_telnyx_id_idx" ON "sms_messages" ("telnyx_message_id");
