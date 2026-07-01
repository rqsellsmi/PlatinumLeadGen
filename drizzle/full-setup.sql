-- ==============================================================
-- RE/MAX Platinum — FULL DATABASE SETUP (paste into Neon SQL Editor)
-- Run ONCE on a new/empty Neon database. Creates all tables + enums,
-- then seeds the 4 launch cities. No local CLI / git bash needed.
-- If you only need to (re)seed and tables already exist, run
-- drizzle/seed.sql instead (it is idempotent).
-- ==============================================================

-- ---------- schema: migration 0000_init ----------
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'closed', 'lost');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('valuation', 'seller_guide', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('offered', 'accepted', 'declined', 'expired', 'reassigned');--> statement-breakpoint
CREATE TYPE "public"."score_reason" AS ENUM('system_response_fast', 'system_response_good', 'system_response_slow', 'system_no_response', 'system_decline', 'system_closing', 'pipeline_contacted', 'fast_contact_bonus', 'pipeline_qualified', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."script_position" AS ENUM('head', 'body');--> statement-breakpoint
CREATE TABLE "agent_lead_order" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"lead_offer_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_score_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"delta" real NOT NULL,
	"reason" "score_reason" NOT NULL,
	"note" text,
	"lead_id" integer,
	"lead_offer_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" varchar(120) NOT NULL,
	"last_name" varchar(120) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(40),
	"office_id" integer,
	"latitude" real,
	"longitude" real,
	"score" real DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"magic_link_token" varchar(128),
	"magic_link_expires_at" timestamp,
	"password_hash" varchar(200),
	"password_reset_token" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"key_hash" varchar(200) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" varchar(120) NOT NULL,
	"ip" varchar(64),
	"status_code" integer,
	"meta" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"name" varchar(200) NOT NULL,
	"phone" varchar(40),
	"email" varchar(200),
	"preferred_time" varchar(200),
	"notes" text,
	"source" varchar(80) DEFAULT 'thank-you' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_page_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_homes_sold" integer,
	"avg_days_to_sell" integer,
	"avg_sale_price" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"status" "offer_status" DEFAULT 'offered' NOT NULL,
	"offer_token" varchar(128) NOT NULL,
	"token_expires_at" timestamp,
	"token_used_at" timestamp,
	"offer_sent_at" timestamp,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"expired_at" timestamp,
	"first_update_due" timestamp,
	"first_update_submitted_at" timestamp,
	"escalation_sent_at" timestamp,
	"next_reminder_due" timestamp,
	"distance_miles" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(128),
	"lead_type" "lead_type" DEFAULT 'valuation' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"first_name" varchar(120),
	"last_name" varchar(120),
	"email" varchar(200),
	"phone" varchar(40),
	"property_address" varchar(300),
	"property_city" varchar(120),
	"property_state" varchar(10),
	"property_zip" varchar(20),
	"property_lat" real,
	"property_lng" real,
	"timeframe" varchar(80),
	"estimated_value" integer,
	"price_range_low" integer,
	"price_range_high" integer,
	"location_id" integer,
	"source" varchar(80) DEFAULT 'website' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp,
	"last_status_changed_at" timestamp,
	"stale_warning_sent_at" timestamp,
	"last_penalty_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"state" varchar(10) DEFAULT 'MI' NOT NULL,
	"latitude" real,
	"longitude" real,
	"meta_title" varchar(200),
	"meta_description" varchar(500),
	"hero_headline" varchar(300),
	"hero_subheadline" varchar(500),
	"faq_json" text,
	"guide_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"avg_sale_price" integer,
	"days_to_sell" integer,
	"homes_sold" integer,
	"percent_of_list_price" integer,
	"percent_above_list" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neighborhood_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"label" varchar(200) NOT NULL,
	"url" varchar(500) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_email" varchar(200),
	"offer_window_start_hour" integer DEFAULT 7 NOT NULL,
	"offer_window_end_hour" integer DEFAULT 20 NOT NULL,
	"proximity_radius_miles" integer DEFAULT 20 NOT NULL,
	"queue_pointer" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"address" varchar(300),
	"city" varchar(120),
	"state" varchar(10),
	"zip" varchar(20),
	"phone" varchar(40),
	"latitude" real,
	"longitude" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recent_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"address" varchar(300) NOT NULL,
	"sold_price" integer,
	"days_on_market" integer,
	"close_date" timestamp,
	"photo_url" varchar(500),
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_offer_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"new_status" "lead_status" NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"client_name" varchar(200) NOT NULL,
	"neighborhood" varchar(200),
	"quote" text NOT NULL,
	"sale_details" varchar(200),
	"photo_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_scripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer,
	"name" varchar(200) NOT NULL,
	"position" "script_position" DEFAULT 'body' NOT NULL,
	"script_content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_lead_order" ADD CONSTRAINT "agent_lead_order_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_lead_order" ADD CONSTRAINT "agent_lead_order_lead_offer_id_lead_offers_id_fk" FOREIGN KEY ("lead_offer_id") REFERENCES "public"."lead_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_score_log" ADD CONSTRAINT "agent_score_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_score_log" ADD CONSTRAINT "agent_score_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_score_log" ADD CONSTRAINT "agent_score_log_lead_offer_id_lead_offers_id_fk" FOREIGN KEY ("lead_offer_id") REFERENCES "public"."lead_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_offers" ADD CONSTRAINT "lead_offers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_offers" ADD CONSTRAINT "lead_offers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_stats" ADD CONSTRAINT "market_stats_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighborhood_links" ADD CONSTRAINT "neighborhood_links_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_sales" ADD CONSTRAINT "recent_sales_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_lead_offer_id_lead_offers_id_fk" FOREIGN KEY ("lead_offer_id") REFERENCES "public"."lead_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_scripts" ADD CONSTRAINT "tracking_scripts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_lead_order_uniq" ON "agent_lead_order" USING btree ("agent_id","lead_offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_email_idx" ON "agents" USING btree ("email");--> statement-breakpoint
CREATE INDEX "agents_magic_token_idx" ON "agents" USING btree ("magic_link_token");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_offers_token_idx" ON "lead_offers" USING btree ("offer_token");--> statement-breakpoint
CREATE INDEX "lead_offers_lead_idx" ON "lead_offers" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_offers_agent_idx" ON "lead_offers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "lead_offers_status_idx" ON "lead_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_session_idx" ON "leads" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_slug_idx" ON "locations" USING btree ("slug");
-- ---------- schema: migration 0001 ----------
CREATE TABLE "rate_limits" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"reset_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- ---------- schema: migration 0002_v15_additions ----------
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

-- ---------- seed data ----------
-- RE/MAX Platinum — seed data (Sections 3.4).
-- Idempotent: safe to re-run. Inserts the 4 launch cities + singleton config rows.

INSERT INTO locations (slug, name, state, latitude, longitude, meta_title, meta_description, hero_headline, hero_subheadline, faq_json, is_active)
VALUES ('brighton-mi', 'Brighton, Michigan', 'MI', 42.5295, -83.7799, 'Brighton MI Home Values & Free Home Valuation | RE/MAX Platinum', 'Find out what your Brighton, MI home is worth. Free home valuation from RE/MAX Platinum — local experts. See current market stats and recent sales.', 'What Is My Home Worth in Brighton, MI?', 'Get a free, instant home valuation based on recent Brighton sales — then connect with a local RE/MAX Platinum expert to maximize your sale price.', '[{"question": "How much is my home worth in Brighton, MI?", "answer": "Home values in Brighton, MI vary by neighborhood, condition, and current market demand. Enter your address above for a free instant estimate based on recent Brighton sales, then connect with a local RE/MAX Platinum expert for a precise valuation."}, {"question": "How long does it take to sell a home in Brighton?", "answer": "Average time-to-sell in Brighton depends on pricing and market conditions. Our local agents price strategically to sell quickly while maximizing your return."}, {"question": "What percentage of asking price do homes sell for in Brighton?", "answer": "Well-priced Brighton homes routinely sell at or above asking. We track current sale-to-list ratios so your home is priced to compete."}, {"question": "Do I need to make repairs before selling?", "answer": "Not always. RE/MAX Platinum advises on the highest-ROI improvements \u2014 and which to skip \u2014 so you don''t overspend before listing. Many homes sell as-is."}, {"question": "How do I get started?", "answer": "Enter your address in the valuation tool above to get your free estimate. A local RE/MAX Platinum expert will follow up to review your personalized market report."}]', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, state = EXCLUDED.state, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  meta_title = EXCLUDED.meta_title, meta_description = EXCLUDED.meta_description,
  hero_headline = EXCLUDED.hero_headline, hero_subheadline = EXCLUDED.hero_subheadline,
  faq_json = EXCLUDED.faq_json, is_active = true, updated_at = now();

INSERT INTO locations (slug, name, state, latitude, longitude, meta_title, meta_description, hero_headline, hero_subheadline, faq_json, is_active)
VALUES ('ann-arbor-mi', 'Ann Arbor, Michigan', 'MI', 42.2808, -83.743, 'Ann Arbor MI Home Values & Free Home Valuation | RE/MAX Platinum', 'Find out what your Ann Arbor, MI home is worth. Free home valuation from RE/MAX Platinum — local experts. See current market stats and recent sales.', 'What Is My Home Worth in Ann Arbor, MI?', 'Get a free, instant home valuation based on recent Ann Arbor sales — then connect with a local RE/MAX Platinum expert to maximize your sale price.', '[{"question": "How much is my home worth in Ann Arbor, MI?", "answer": "Home values in Ann Arbor, MI vary by neighborhood, condition, and current market demand. Enter your address above for a free instant estimate based on recent Ann Arbor sales, then connect with a local RE/MAX Platinum expert for a precise valuation."}, {"question": "How long does it take to sell a home in Ann Arbor?", "answer": "Average time-to-sell in Ann Arbor depends on pricing and market conditions. Our local agents price strategically to sell quickly while maximizing your return."}, {"question": "What percentage of asking price do homes sell for in Ann Arbor?", "answer": "Well-priced Ann Arbor homes routinely sell at or above asking. We track current sale-to-list ratios so your home is priced to compete."}, {"question": "Do I need to make repairs before selling?", "answer": "Not always. RE/MAX Platinum advises on the highest-ROI improvements \u2014 and which to skip \u2014 so you don''t overspend before listing. Many homes sell as-is."}, {"question": "How do I get started?", "answer": "Enter your address in the valuation tool above to get your free estimate. A local RE/MAX Platinum expert will follow up to review your personalized market report."}]', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, state = EXCLUDED.state, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  meta_title = EXCLUDED.meta_title, meta_description = EXCLUDED.meta_description,
  hero_headline = EXCLUDED.hero_headline, hero_subheadline = EXCLUDED.hero_subheadline,
  faq_json = EXCLUDED.faq_json, is_active = true, updated_at = now();

INSERT INTO locations (slug, name, state, latitude, longitude, meta_title, meta_description, hero_headline, hero_subheadline, faq_json, is_active)
VALUES ('fenton-mi', 'Fenton, Michigan', 'MI', 42.7959, -83.7085, 'Fenton MI Home Values & Free Home Valuation | RE/MAX Platinum', 'Find out what your Fenton, MI home is worth. Free home valuation from RE/MAX Platinum — local experts. See current market stats and recent sales.', 'What Is My Home Worth in Fenton, MI?', 'Get a free, instant home valuation based on recent Fenton sales — then connect with a local RE/MAX Platinum expert to maximize your sale price.', '[{"question": "How much is my home worth in Fenton, MI?", "answer": "Home values in Fenton, MI vary by neighborhood, condition, and current market demand. Enter your address above for a free instant estimate based on recent Fenton sales, then connect with a local RE/MAX Platinum expert for a precise valuation."}, {"question": "How long does it take to sell a home in Fenton?", "answer": "Average time-to-sell in Fenton depends on pricing and market conditions. Our local agents price strategically to sell quickly while maximizing your return."}, {"question": "What percentage of asking price do homes sell for in Fenton?", "answer": "Well-priced Fenton homes routinely sell at or above asking. We track current sale-to-list ratios so your home is priced to compete."}, {"question": "Do I need to make repairs before selling?", "answer": "Not always. RE/MAX Platinum advises on the highest-ROI improvements \u2014 and which to skip \u2014 so you don''t overspend before listing. Many homes sell as-is."}, {"question": "How do I get started?", "answer": "Enter your address in the valuation tool above to get your free estimate. A local RE/MAX Platinum expert will follow up to review your personalized market report."}]', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, state = EXCLUDED.state, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  meta_title = EXCLUDED.meta_title, meta_description = EXCLUDED.meta_description,
  hero_headline = EXCLUDED.hero_headline, hero_subheadline = EXCLUDED.hero_subheadline,
  faq_json = EXCLUDED.faq_json, is_active = true, updated_at = now();

INSERT INTO locations (slug, name, state, latitude, longitude, meta_title, meta_description, hero_headline, hero_subheadline, faq_json, is_active)
VALUES ('grand-blanc-mi', 'Grand Blanc, Michigan', 'MI', 42.9267, -83.6305, 'Grand Blanc MI Home Values & Free Home Valuation | RE/MAX Platinum', 'Find out what your Grand Blanc, MI home is worth. Free home valuation from RE/MAX Platinum — local experts. See current market stats and recent sales.', 'What Is My Home Worth in Grand Blanc, MI?', 'Get a free, instant home valuation based on recent Grand Blanc sales — then connect with a local RE/MAX Platinum expert to maximize your sale price.', '[{"question": "How much is my home worth in Grand Blanc, MI?", "answer": "Home values in Grand Blanc, MI vary by neighborhood, condition, and current market demand. Enter your address above for a free instant estimate based on recent Grand Blanc sales, then connect with a local RE/MAX Platinum expert for a precise valuation."}, {"question": "How long does it take to sell a home in Grand Blanc?", "answer": "Average time-to-sell in Grand Blanc depends on pricing and market conditions. Our local agents price strategically to sell quickly while maximizing your return."}, {"question": "What percentage of asking price do homes sell for in Grand Blanc?", "answer": "Well-priced Grand Blanc homes routinely sell at or above asking. We track current sale-to-list ratios so your home is priced to compete."}, {"question": "Do I need to make repairs before selling?", "answer": "Not always. RE/MAX Platinum advises on the highest-ROI improvements \u2014 and which to skip \u2014 so you don''t overspend before listing. Many homes sell as-is."}, {"question": "How do I get started?", "answer": "Enter your address in the valuation tool above to get your free estimate. A local RE/MAX Platinum expert will follow up to review your personalized market report."}]', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, state = EXCLUDED.state, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  meta_title = EXCLUDED.meta_title, meta_description = EXCLUDED.meta_description,
  hero_headline = EXCLUDED.hero_headline, hero_subheadline = EXCLUDED.hero_subheadline,
  faq_json = EXCLUDED.faq_json, is_active = true, updated_at = now();

-- Singleton config rows (only if absent)
INSERT INTO notification_settings (offer_window_start_hour, offer_window_end_hour, proximity_radius_miles, queue_pointer)
SELECT 7, 20, 20, 0 WHERE NOT EXISTS (SELECT 1 FROM notification_settings);

INSERT INTO home_page_metrics (total_homes_sold, avg_days_to_sell, avg_sale_price)
SELECT NULL, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM home_page_metrics);
