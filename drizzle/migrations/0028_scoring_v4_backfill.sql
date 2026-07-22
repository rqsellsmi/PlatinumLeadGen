-- Map the v2 statuses onto the v4 Seller Track set. Runs AFTER 0027 has
-- committed so the newly-added enum values are usable (Postgres forbids using a
-- new enum value in the same transaction that added it). Pre-launch: these are
-- a safe no-op when there is no matching data. Hand-authored, idempotent.

UPDATE "leads" SET "status" = 'connected' WHERE "status" = 'contacted';--> statement-breakpoint
UPDATE "leads" SET "status" = 'nurturing' WHERE "status" IN ('qualified', 'working');
