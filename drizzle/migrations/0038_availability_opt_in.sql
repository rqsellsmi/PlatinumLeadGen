-- P0.8b — availability becomes OPT-IN (decision D7).
--
-- `is_available` defaulted to true, so a newly-added agent was immediately in
-- the routing queue and receiving seller leads before they had set a password,
-- seen the Help guide, or agreed to anything. Under the D7 lifecycle it is the
-- agent's own switch, so it defaults to false and they turn it on.
--
-- Only the DEFAULT changes. Existing rows are deliberately left alone: flipping
-- the live roster to unavailable here would silently stop lead routing the
-- moment this migration ran. The Launch button (D7) is what sets the roster to
-- opt-in, deliberately and visibly, at the moment the owner chooses.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` (lessons-learned §1).

ALTER TABLE "agents" ALTER COLUMN "is_available" SET DEFAULT false;
