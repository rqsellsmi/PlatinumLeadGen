-- Link a lead back to the buyer account that engaged (favorite/save/showing/
-- contact). Nullable — seller leads and pre-account leads have no buyer user.
-- Hand-authored, idempotent.

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "buyer_user_id" integer REFERENCES "buyer_users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "leads_buyer_user_idx" ON "leads" ("buyer_user_id");
