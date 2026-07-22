-- Buyer/Seller classification for leads (groundwork). This is a label only —
-- no routing/scoring impact — and there is no buyer capture flow yet, so every
-- current lead is seller-side and the column defaults to 'seller'. 'unknown'
-- is available for leads whose intent isn't known. Hand-authored, idempotent.

DO $$ BEGIN
  CREATE TYPE "public"."lead_intent" AS ENUM('seller', 'buyer', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "intent" "lead_intent" NOT NULL DEFAULT 'seller';
