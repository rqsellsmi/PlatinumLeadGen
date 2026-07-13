-- Widen the IDX URL columns that a long Realcomp media/tour URL can overflow.
-- Realcomp MediaURL values are signed CDN URLs whose length we don't control and
-- which can exceed varchar(1000); a single long URL would halt the 50k-row
-- `active` photo insert the same way the descriptive columns did in 0016.
--
-- Postgres `text` and `varchar(n)` are identical in storage/speed — the only
-- difference is the length cap, which is what breaks the batch. Idempotent:
-- `ALTER COLUMN ... TYPE text` is a no-op when the column is already text, so
-- this is safe to re-run on any Neon branch.
ALTER TABLE "idx_listings" ALTER COLUMN "photo_url" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "virtual_tour_url" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listing_photos" ALTER COLUMN "media_url" TYPE text;
