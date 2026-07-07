-- Per-agent proximity preferences: agents choose the anchor their acceptance
-- distance is measured from (their office or a personal city they geocode) and
-- how far they'll accept leads.
ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "proximity_anchor" varchar(10) DEFAULT 'office' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "location_city" varchar(200);
--> statement-breakpoint
ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "proximity_radius_miles" real;
