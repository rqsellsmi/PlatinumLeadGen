-- Per-office Google Business Profile: each office has its own Place ID, so
-- reviews are fetched per office rather than from one global place. The
-- rating/count/fetched-at are cached from the last Places Details call; the
-- individual review rows continue to live in google_reviews (keyed by place_id).
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "google_place_id" varchar(200);
--> statement-breakpoint
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "google_review_rating" real;
--> statement-breakpoint
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "google_review_count" integer;
--> statement-breakpoint
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "google_reviews_fetched_at" timestamp;
