-- Shared "agent setup code" for the public first-time password-setup page
-- (/agent/set-password). The admin sets it in Settings and shares it with the
-- team; the page requires it (plus a known agent email) before a password can
-- be set or reset. Hand-authored, idempotent.

ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "agent_setup_code" varchar(60);
