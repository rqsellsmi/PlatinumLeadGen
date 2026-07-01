-- ---------------------------------------------------------------------------
-- Recent-sales tiles are now driven by imported closings:
--   closings.photo_url    — optional showcase photo for a sale shown on a tile
--   locations.match_cities — comma-separated mailing cities a location covers
--                            (matches closings.city; null → location's own name)
-- ---------------------------------------------------------------------------
ALTER TABLE "closings" ADD COLUMN IF NOT EXISTS "photo_url" varchar(500);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "match_cities" text;
