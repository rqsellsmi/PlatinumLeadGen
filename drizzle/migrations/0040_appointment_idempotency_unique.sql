-- Atomic appointment idempotency (P0.3 / D5 follow-up).
--
-- 0035 created a NON-unique index on appointment_requests.idempotency_key, and
-- the route deduped with a SELECT-then-INSERT. That races: two concurrent copies
-- of the same request both pass the check and create duplicate leads,
-- appointments, emails and routing. The key is a fresh random UUID generated per
-- form mount, so a permanent UNIQUE constraint is the right guard — the route
-- now claims the key with INSERT ... ON CONFLICT DO NOTHING. NULL keys stay
-- allowed and never conflict (default NULLS DISTINCT), so a keyless request is
-- unaffected.
--
-- Drop any pre-existing duplicate non-null keys first (keep the earliest row) or
-- the unique index cannot be built. In practice there should be none — the keys
-- are random per mount — but a race that already happened, or test data, could
-- leave some. Hand-authored and idempotent (lessons-learned §1).

DELETE FROM "appointment_requests" a
 USING "appointment_requests" b
 WHERE a."idempotency_key" IS NOT NULL
   AND a."idempotency_key" = b."idempotency_key"
   AND a."id" > b."id";

DROP INDEX IF EXISTS "appointment_requests_idempotency_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_requests_idempotency_key_uniq"
  ON "appointment_requests" ("idempotency_key");
