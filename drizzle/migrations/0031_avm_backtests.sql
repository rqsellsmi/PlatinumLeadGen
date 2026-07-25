-- Homegrown-AVM backtest scoreboard. One row per hold-one-out run: value an
-- already-sold home from the OTHER comps (the home's most-recent sale held out
-- entirely — price and facts), then record our estimate vs. the provider AVM vs.
-- the actual sale price. Re-running an address after an engine change appends a
-- new row, so accuracy improvement is legible over time. Admin-internal only;
-- no consumer/seller-facing surface (see docs/superpowers/specs §18/§19).
CREATE TABLE IF NOT EXISTS "avm_backtests" (
  "id" serial PRIMARY KEY,
  "normalized_address" varchar(500) NOT NULL,
  "address" varchar(300),
  "subject_json" text,                         -- subject facts used + their provenance
  "facts_source" varchar(40),                  -- mls_prior_sale | provider | manual | insufficient
  "held_out_listing_key" varchar(100),         -- the most-recent sale we graded against
  "actual_sale_price" integer,                 -- ground truth
  "actual_sale_date" timestamp,
  "provider" varchar(20),                       -- attom | rentcast (null if not fetched)
  "provider_value" integer,
  "provider_low" integer,
  "provider_high" integer,
  "custom_value" integer,
  "custom_low" integer,
  "custom_high" integer,
  "custom_confidence" varchar(20),              -- low | medium | high
  "comps_json" text,                            -- ranked comps + reasons + adjustment line items
  "engine_version" varchar(20),
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avm_backtests_addr_idx" ON "avm_backtests" ("normalized_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avm_backtests_created_idx" ON "avm_backtests" ("created_at");
