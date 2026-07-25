-- Admin-editable exclusion list for the buyer homepage city tiles (O5). These
-- cities are dropped from the 12-tile "browse by city" grid on the buyer home,
-- but STILL resolve normally in /homes search (a buyer can search them). Stored
-- as a comma-separated list on the single notification_settings row so the admin
-- can edit it without a deploy. Hand-authored, idempotent.

ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "buyer_excluded_cities" text;

-- Seed the default exclusions on the existing settings row when unset.
UPDATE "notification_settings"
   SET "buyer_excluded_cities" = 'Flint,Pontiac,Detroit'
 WHERE "buyer_excluded_cities" IS NULL;
