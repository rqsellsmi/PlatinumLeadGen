-- Cached AVM-provider property records (owner, features, tax, sale history),
-- keyed by normalized address so repeated lead-detail opens and the admin
-- lookup tool reuse one cached fetch instead of re-billing the provider.
CREATE TABLE IF NOT EXISTS "property_records" (
  "id" serial PRIMARY KEY,
  "normalized_address" varchar(500) NOT NULL,
  "address" varchar(300),
  "provider" varchar(20) NOT NULL DEFAULT 'rentcast',
  "raw_json" text,
  "fetched_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "property_records_addr_idx" ON "property_records" ("normalized_address");
