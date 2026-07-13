-- Cached AI-written market-report narratives, keyed by lower(city). Regenerated
-- only when the underlying stats change (tracked by `signature`), so the report
-- doesn't call the model on every page render.
CREATE TABLE IF NOT EXISTS "market_narratives" (
  "id" serial PRIMARY KEY,
  "city_key" varchar(200) NOT NULL,
  "narrative" text,
  "signature" varchar(120),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_narratives_city_idx" ON "market_narratives" ("city_key");
