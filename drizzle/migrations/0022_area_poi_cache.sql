-- Cache for "neighborhood highlights" (nearby restaurants, parks, coffee,
-- groceries, golf, etc.) from Google Places Nearby Search. Keyed by a coarse
-- coordinate grid cell (~110 m) so nearby listings share one lookup and repeat
-- views never re-bill Google; the payload stores each POI's own coordinates so
-- exact per-home distances are recomputed at render. Idempotent.
CREATE TABLE IF NOT EXISTS "area_poi_cache" (
  "id" serial PRIMARY KEY,
  "geo_key" varchar(40) NOT NULL,
  "latitude" real,
  "longitude" real,
  "payload_json" text,
  "error" text,
  "fetched_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "area_poi_cache_geo_idx" ON "area_poi_cache" ("geo_key");
