-- Representation question + referral-fee three-state model + held points.
-- Hand-authored, idempotent.
--
-- Representation: does the buyer already work with an agent? (none / our_agent /
-- other_brokerage). Referral status: whether the brokerage's 30% referral is
-- owed on this lead (eligible by default; pending_review while a buyer claims one
-- of our agents; exempt once an admin confirms a pre-existing client). Held score
-- log rows (is_held=true) are logged but excluded from an agent's totals until an
-- admin resolves the referral.

-- Enum types (guarded so re-runs are no-ops).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'representation') THEN
    CREATE TYPE "representation" AS ENUM ('none', 'our_agent', 'other_brokerage');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_status') THEN
    CREATE TYPE "referral_status" AS ENUM ('eligible', 'pending_review', 'exempt');
  END IF;
END $$;

-- Agents: a display name for the representation picker (nickname vs legal name).
ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "display_name" varchar(200);

-- Leads: representation answer + claimed agent + referral state machine.
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "representation" "representation" NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "claimed_agent_id" integer REFERENCES "agents"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "claimed_agent_name" text,
  ADD COLUMN IF NOT EXISTS "referral_status" "referral_status" NOT NULL DEFAULT 'eligible',
  ADD COLUMN IF NOT EXISTS "referral_resolved_by" integer,
  ADD COLUMN IF NOT EXISTS "referral_resolved_at" timestamp;

CREATE INDEX IF NOT EXISTS "leads_referral_status_idx" ON "leads" ("referral_status");

-- Held points: a score-log row that is recorded but excluded from the agent's
-- four tracks until released. Existing rows default false (unaffected).
ALTER TABLE "agent_score_log"
  ADD COLUMN IF NOT EXISTS "is_held" boolean NOT NULL DEFAULT false;
