-- Buyer lead intake fields. A buyer inquiry (schedule-a-showing / contact-an-agent
-- on a listing) becomes a lead with intent='buyer' tied to the listing it was made
-- on, routed through the existing pipeline. Adds:
--   - leads.interested_listing_key: which IDX listing the buyer inquired on.
--   - appointment_requests.listing_key: the listing a showing request is for.
--   - lead_type 'buyer_inquiry': distinguishes buyer inquiries in reporting.
-- The new enum value is only USED at runtime (never in this migration), so adding
-- it here is safe. Hand-authored, idempotent.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "interested_listing_key" varchar(100);
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "listing_key" varchar(100);
ALTER TYPE "lead_type" ADD VALUE IF NOT EXISTS 'buyer_inquiry';
