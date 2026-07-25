-- Buyer Track score reasons — a tunable duplicate of the seller pipeline reasons
-- so buyer point values (BUYER_TRACK in lib/trackConfig.ts) can be adjusted
-- independently of the seller track. The buyer track REUSES the existing
-- lead_status values (no new statuses) and buyer Lost reasons are free-text
-- (leads.lost_reason is a varchar, not an enum), so only score_reason grows here.
-- New enum values are only USED at runtime, never in this migration. Idempotent.

ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'buyer_attempted';
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'buyer_connected';
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'buyer_signed';
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'buyer_closing';
ALTER TYPE "score_reason" ADD VALUE IF NOT EXISTS 'buyer_fast_engagement';
