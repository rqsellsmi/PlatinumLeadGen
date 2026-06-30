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