-- Valuation cache (30 days, keyed by normalized address) + full AVM detail.
--
-- `normalized_address` is the cache key; `valued_at` is when the PROVIDER data
-- was fetched (distinct from created_at, which is when the row was written — a
-- row that copies a fresh cache hit keeps the original fetch time). `detail`
-- holds the JSON PropertyRecord parsed from the AVM response.
ALTER TABLE "valuations" ADD COLUMN IF NOT EXISTS "normalized_address" varchar(300);
--> statement-breakpoint
ALTER TABLE "valuations" ADD COLUMN IF NOT EXISTS "valued_at" timestamp;
--> statement-breakpoint
ALTER TABLE "valuations" ADD COLUMN IF NOT EXISTS "detail" text;
--> statement-breakpoint
-- Existing rows: the row was written immediately after the provider call, so
-- created_at is the fetch time. They have no normalized_address and so never
-- serve as a cache hit — they refresh on next view, which is the intent.
UPDATE "valuations" SET "valued_at" = "created_at" WHERE "valued_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "valuations_normalized_address_idx"
  ON "valuations" ("normalized_address","valued_at");
