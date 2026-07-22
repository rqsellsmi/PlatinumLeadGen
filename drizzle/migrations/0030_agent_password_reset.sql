-- Email-verified "forgot password" flow. agents.password_reset_token already
-- exists (unused); this adds its expiry so an emailed reset link is
-- time-limited. (The public /agent/set-password code page is first-time-only;
-- resets go through the emailed link instead.) Hand-authored, idempotent.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "password_reset_expires_at" timestamp;
