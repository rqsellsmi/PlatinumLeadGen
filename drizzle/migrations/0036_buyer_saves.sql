-- Buyer saved homes (favorites), saved searches (filter sets, re-run live), and
-- the viewing-activity log. All scoped to a buyer_user and cascade-deleted with the
-- account. Hand-authored, idempotent.

CREATE TABLE IF NOT EXISTS "buyer_favorites" (
  "id" serial PRIMARY KEY NOT NULL,
  "buyer_user_id" integer NOT NULL REFERENCES "buyer_users"("id") ON DELETE CASCADE,
  "listing_key" varchar(100) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_favorites_uniq" ON "buyer_favorites" ("buyer_user_id", "listing_key");

CREATE TABLE IF NOT EXISTS "buyer_saved_searches" (
  "id" serial PRIMARY KEY NOT NULL,
  "buyer_user_id" integer NOT NULL REFERENCES "buyer_users"("id") ON DELETE CASCADE,
  "name" varchar(200) NOT NULL,
  "filters_json" text NOT NULL,
  "anchor_lat" real,
  "anchor_lng" real,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "buyer_saved_searches_user_idx" ON "buyer_saved_searches" ("buyer_user_id");

CREATE TABLE IF NOT EXISTS "buyer_listing_views" (
  "id" serial PRIMARY KEY NOT NULL,
  "buyer_user_id" integer NOT NULL REFERENCES "buyer_users"("id") ON DELETE CASCADE,
  "listing_key" varchar(100) NOT NULL,
  "first_viewed_at" timestamp NOT NULL DEFAULT now(),
  "last_viewed_at" timestamp NOT NULL DEFAULT now(),
  "view_count" integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_listing_views_uniq" ON "buyer_listing_views" ("buyer_user_id", "listing_key");
