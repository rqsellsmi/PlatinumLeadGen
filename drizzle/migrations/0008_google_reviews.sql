-- Testimonials source toggle + Google Places review cache.
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "testimonial_source" varchar(10) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "google_place_id" varchar(200);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "place_id" varchar(200) NOT NULL,
  "author_name" varchar(200),
  "rating" integer,
  "text" text,
  "relative_time" varchar(100),
  "profile_photo_url" varchar(500),
  "review_time" integer,
  "fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_reviews_place_idx" ON "google_reviews" ("place_id");
