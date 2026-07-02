-- Identifiers captured on the ATTOM AVM call, used post-conversion on the
-- report page to pull area sales trends (area_geo_id) and sales comparables
-- (attom_id). Nullable; only populated when VALUATION_PROVIDER=attom.
ALTER TABLE "valuations" ADD COLUMN IF NOT EXISTS "attom_id" varchar(40);
--> statement-breakpoint
ALTER TABLE "valuations" ADD COLUMN IF NOT EXISTS "area_geo_id" varchar(40);
