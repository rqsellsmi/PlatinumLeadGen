-- Expand idx_listings with the buyer-relevant "data sheet" fields (HOA dues,
-- taxes, heating/cooling, fireplace, laundry, water/sewer, interior/exterior
-- features, appliances, style, etc.) so the listing detail page can render the
-- full sheet and buyers can see what they search on. All nullable and additive.
--
-- text (not varchar) for the descriptive/enum-serialized columns per the
-- external-feed rule (0016): Realcomp enum multi-values serialize to comma
-- lists whose length we don't control. Idempotent (ADD COLUMN IF NOT EXISTS),
-- so it's safe to re-run on every Neon branch. Populated on the next IDX sync /
-- backfill — until then these read NULL and the UI hides the missing fields.
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "architectural_style" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "levels" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "stories_total" integer;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "rooms_total" integer;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "heating" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "cooling" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "fireplaces_total" integer;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "fireplace_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "laundry_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "interior_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "exterior_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "appliances" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "flooring" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "construction_materials" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "roof" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "foundation_details" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "parking_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "attached_garage_yn" boolean;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "pool_private_yn" boolean;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "pool_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "patio_and_porch_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "lot_features" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "lot_size_dimensions" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "view" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "water_source" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "sewer" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "utilities" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "new_construction_yn" boolean;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "zoning" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "association_yn" boolean;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "association_fee" real;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "association_fee_frequency" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "association_fee_includes" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "association_amenities" text;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "tax_annual_amount" real;
--> statement-breakpoint
ALTER TABLE "idx_listings" ADD COLUMN IF NOT EXISTS "tax_year" integer;
