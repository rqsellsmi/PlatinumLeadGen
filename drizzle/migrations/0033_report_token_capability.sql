-- P0.1 / P0.3 — the report token becomes a real lead-bound CAPABILITY.
--
-- Review items #7 / #10 / #14, owner decisions D3 (possession-verified reveal),
-- D4/D5 (appointments ride the same capability) and D15 (the /thank-you
-- qualifiers write through it). Previously `leads.report_token` was random but
-- permanent, with no expiry and no way to revoke a leaked link.
--
-- Also adds the lightweight `is_test` suppression flag (D20/D23 MODIFIED): set
-- automatically at lead creation when the contact matches the reserved
-- test-contact allowlist, then excluded from routing, scoring, leaderboards,
-- agent notifications, Google Ads exports and KPIs.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` in this repo
-- (docs/lessons-learned.md §1: the snapshot chain is intentionally incomplete
-- and generate produces a destructive diff).

-- Report-token capability: issuance, expiry, revocation.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "report_token_issued_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "report_token_expires_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "report_token_revoked_at" timestamp;

-- Prod smoke-test suppression (D20/D23 MODIFIED).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;

-- Optional seller qualifiers captured on /thank-you (D15). Non-blocking,
-- save-on-select, written through the report-token capability. They inform
-- follow-up priority and the agent's first-call context — never routing and
-- never the agent performance score.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualifier_is_owner" varchar(20);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualifier_occupancy" varchar(20);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualifier_condition" varchar(30);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualifier_motivation" varchar(500);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "qualifiers_updated_at" timestamp;

-- Existing tokens were issued with no expiry. Backfill an issue date so they
-- age out on the same TTL as new ones rather than staying valid forever.
UPDATE "leads"
   SET "report_token_issued_at" = COALESCE("report_token_issued_at", "created_at"),
       "report_token_expires_at" = COALESCE("report_token_expires_at", "created_at" + interval '30 days')
 WHERE "report_token" IS NOT NULL;

-- Partial index: the reveal path always filters on a live (unrevoked) token.
CREATE INDEX IF NOT EXISTS "leads_is_test_idx" ON "leads" ("is_test");
