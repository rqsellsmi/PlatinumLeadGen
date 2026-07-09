-- Widen IDX listing text columns that overflow varchar(100)/(50) on the live
-- Realcomp feed. The initial `active` backfill fetched 50k listings then failed
-- with `value too long for type character varying(100)` (Postgres 22001): MLS
-- data has uncontrolled string lengths — notably `basement` (a multi-value enum
-- serialized to a comma list) and the county-suffixed city/area enums.
--
-- Postgres `text` and `varchar` are identical in storage and speed; the only
-- difference is the length cap, which is exactly what's breaking the batch. So
-- drop the cap on the descriptive/enum columns rather than guess a bigger number.
--
-- Idempotent: `ALTER COLUMN ... TYPE text` is a no-op (and errors-free) when the
-- column is already text, so this is safe to re-run on any Neon branch.
ALTER TABLE "idx_listings" ALTER COLUMN "city" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "postal_city" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "original_city" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "original_postal_city" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "county_or_parish" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "township" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "subdivision_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "mls_area_major" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "basement" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "school_district" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "water_body_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "property_type" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "property_sub_type" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "originating_system_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "listing_office_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ALTER COLUMN "address" TYPE text;
