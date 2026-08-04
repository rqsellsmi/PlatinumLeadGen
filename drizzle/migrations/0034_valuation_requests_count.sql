-- P0.7 / decision D2 — rename the misleading "social proof" counter.
--
-- `locations.social_proof_count` was incremented once per FORM SUBMISSION and
-- then rendered publicly as "N+ homes sold" and "N homeowners served". That is
-- a lead count presented as an achievement: the Brighton page showed "1+ homes
-- sold" beside its own market section reporting 89 actual sales.
--
-- The counter itself is worth keeping — as an INTERNAL operations metric. The
-- rename is the point: a column named `valuation_requests_count` cannot be
-- mistaken for a sales figure by the next person to wire up a page. Public
-- "homes sold" now reads verified transactions (market_stats / IDX office
-- deals) instead.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` (lessons-learned §1).
-- `ALTER TABLE … RENAME COLUMN` has no IF EXISTS form, so it is guarded on the
-- catalog: the rename runs only when the old column is present and the new one
-- is not, making a re-run on an already-migrated branch a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'locations' AND column_name = 'social_proof_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'locations' AND column_name = 'valuation_requests_count'
  ) THEN
    ALTER TABLE "locations" RENAME COLUMN "social_proof_count" TO "valuation_requests_count";
  END IF;
END $$;

-- Fresh branches that never had the old column still need the new one.
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "valuation_requests_count" integer DEFAULT 0 NOT NULL;
