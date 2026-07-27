-- Guide-identity capture. Records WHICH downloadable guide a seller_guide lead
-- came from, so per-guide reporting is possible later even when all downloads
-- fire one "Guide Download" Google Ads conversion. Nullable (valuation leads and
-- legacy location.guideUrl downloads have no guide id). Hand-authored, idempotent.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "guide_id" integer;
