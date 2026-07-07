-- Link each city page to the office whose Google Business Profile powers its
-- reviews. Null = fall back to a mix of all offices' reviews.
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "office_id" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_office_id_offices_id_fk'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_office_id_offices_id_fk"
      FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE SET NULL;
  END IF;
END $$;
