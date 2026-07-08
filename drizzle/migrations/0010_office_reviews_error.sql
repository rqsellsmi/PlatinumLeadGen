-- Store the last Google reviews fetch error per office so operators can see WHY
-- a fetch returned nothing (Google redacts thrown errors in production).
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "google_reviews_error" varchar(500);
