-- IDX / Realcomp integration (IDX spec §1–§2, §5.3, §8.3).
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS so this can
-- be applied on any Neon branch (main, preview, per-preview) without a diff.

-- 1. Persisted Realcomp OAuth token (single row, keyed by provider). --------
CREATE TABLE IF NOT EXISTS "realcomp_tokens" (
  "id" serial PRIMARY KEY,
  "provider" varchar(50) NOT NULL DEFAULT 'realcomp',
  "access_token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "realcomp_tokens_provider_idx" ON "realcomp_tokens" ("provider");
--> statement-breakpoint

-- 2. Local Realcomp listings mirror. ---------------------------------------
CREATE TABLE IF NOT EXISTS "idx_listings" (
  "id" serial PRIMARY KEY,
  "listing_key" varchar(100) NOT NULL,
  "list_office_key" varchar(100),
  "buyer_office_key" varchar(100),
  "co_list_office_key" varchar(100),
  "co_buyer_office_key" varchar(100),
  "internet_address_display_yn" boolean,
  "internet_entire_listing_display_yn" boolean,
  "mls_number" varchar(50),
  "mls_status" varchar(30),
  "standard_status" varchar(30) NOT NULL,
  "list_price" integer,
  "close_price" integer,
  "close_date" timestamp,
  "days_on_market" integer,
  "cumulative_days_on_market" integer,
  "original_list_price" integer,
  "property_type" varchar(50),
  "property_sub_type" varchar(50),
  "address" varchar(500),
  "city" varchar(100),
  "postal_city" varchar(100),
  "original_city" varchar(100),
  "original_postal_city" varchar(100),
  "county_or_parish" varchar(100),
  "township" varchar(100),
  "subdivision_name" varchar(200),
  "mls_area_major" varchar(100),
  "state_or_province" varchar(10),
  "postal_code" varchar(20),
  "latitude" real,
  "longitude" real,
  "beds_total" integer,
  "baths_total" real,
  "living_area" integer,
  "year_built" integer,
  "lot_size_acres" real,
  "garage_spaces" integer,
  "basement" varchar(100),
  "school_district" varchar(200),
  "waterfront_yn" boolean,
  "waterfront_features" text,
  "water_body_name" varchar(200),
  "water_frontage_feet" real,
  "photo_url" varchar(1000),
  "photos_count" integer,
  "virtual_tour_url" varchar(1000),
  "public_remarks" text,
  "listing_office_name" varchar(500),
  "listing_office_phone" varchar(50),
  "originating_system_name" varchar(100),
  "modification_timestamp" timestamp NOT NULL,
  "is_office_listing" boolean NOT NULL DEFAULT false,
  "last_synced_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_listings_listing_key_idx" ON "idx_listings" ("listing_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_status_idx" ON "idx_listings" ("standard_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_city_idx" ON "idx_listings" ("city");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_county_idx" ON "idx_listings" ("county_or_parish");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_office_idx" ON "idx_listings" ("is_office_listing");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_mod_idx" ON "idx_listings" ("modification_timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_price_idx" ON "idx_listings" ("list_price");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listings_close_date_idx" ON "idx_listings" ("close_date");
--> statement-breakpoint

-- 3. All listing photos (full Media set; display gating lives in the UI). ---
CREATE TABLE IF NOT EXISTS "idx_listing_photos" (
  "id" serial PRIMARY KEY,
  "listing_key" varchar(100) NOT NULL REFERENCES "idx_listings" ("listing_key") ON DELETE CASCADE,
  "media_url" varchar(1000) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "media_category" varchar(50)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listing_photos_listing_idx" ON "idx_listing_photos" ("listing_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_listing_photos_order_idx" ON "idx_listing_photos" ("listing_key", "sort_order");
--> statement-breakpoint

-- 4. Sync run log (separate Q1/Q2 counts). ---------------------------------
CREATE TABLE IF NOT EXISTS "idx_sync_log" (
  "id" serial PRIMARY KEY,
  "sync_started_at" timestamp NOT NULL,
  "sync_completed_at" timestamp,
  "query1_records_fetched" integer,
  "query1_records_upserted" integer,
  "query2_records_fetched" integer,
  "query2_records_upserted" integer,
  "status" varchar(20) NOT NULL,
  "error_message" text
);
--> statement-breakpoint

-- 5. Market-report columns on leads (durable link token + view tracking). ---
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "report_token" varchar(64);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "report_first_accessed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "report_view_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_report_token_idx" ON "leads" ("report_token");
