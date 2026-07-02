-- Two-tier gated valuation store. Full detail lives server-side; the browser
-- only gets the teaser range + basics + token until a lead is linked.
CREATE TABLE IF NOT EXISTS "valuations" (
  "id" serial PRIMARY KEY NOT NULL,
  "token" varchar(64) NOT NULL,
  "provider" varchar(20) DEFAULT 'rentcast' NOT NULL,
  "address" varchar(300),
  "estimated_value" integer,
  "price_range_low" integer,
  "price_range_high" integer,
  "teaser_range_low" integer,
  "teaser_range_high" integer,
  "confidence_score" integer,
  "beds" real,
  "baths" real,
  "sqft" integer,
  "year_built" integer,
  "lot_size_sqft" integer,
  "property_type" varchar(80),
  "sale_history" text,
  "latitude" real,
  "longitude" real,
  "lead_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "valuations" ADD CONSTRAINT "valuations_lead_id_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "valuations_token_idx" ON "valuations" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "valuations_lead_idx" ON "valuations" ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "valuations_created_idx" ON "valuations" ("created_at");
