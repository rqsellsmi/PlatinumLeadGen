-- P0.8a — agent credential security (review #16/#17/#18/#67/#70, decisions D6/D7).
--
-- Three separate problems, one migration:
--
-- 1. MAGIC LINK STORED IN THE CLEAR. `agents.magic_link_token` held the raw
--    bearer token, so anyone who could read the row (a backup, a log, a support
--    query, a leaked dump) had a working 30-day login for that agent. It is now
--    stored as a SHA-256 hash; the raw value exists only in the email that was
--    sent. Kept alongside the old column rather than replacing it so live links
--    in already-delivered emails keep working through the transition — see the
--    backfill at the bottom.
--
-- 2. NO WAY TO REVOKE A SESSION. The signed cookie carried only an agent id and
--    an expiry, so a password reset, a deactivation, or a known-leaked link
--    could not invalidate an outstanding 7-day session. `session_version` is
--    embedded in the cookie and compared on every authenticated read; bumping it
--    invalidates every existing session for that agent at once.
--
-- 3. SHARED BROKERAGE SETUP CODE. First-time password setup was gated by one
--    code plus a rostered email, so anyone holding the code could claim any
--    agent who had not yet set a password (inactive agents explicitly included).
--    Replaced by per-agent, single-use, expiring invites — the same emailed,
--    inbox-verified shape the existing password-reset flow already uses.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` (lessons-learned §1).

-- 1. Hashed magic link.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "magic_link_token_hash" varchar(64);
CREATE INDEX IF NOT EXISTS "agents_magic_token_hash_idx" ON "agents" ("magic_link_token_hash");

-- 2. Session revocation. Existing sessions were minted without a version, and
--    the verifier treats a missing version as 0, so defaulting to 0 keeps every
--    currently-valid session working rather than logging the whole roster out
--    the moment this deploys.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 0 NOT NULL;

-- 3. Per-agent invites. Hash at rest for the same reason as the magic link.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "invite_token_hash" varchar(64);
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "invite_expires_at" timestamp;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "invite_sent_at" timestamp;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "invite_accepted_at" timestamp;
CREATE INDEX IF NOT EXISTS "agents_invite_token_hash_idx" ON "agents" ("invite_token_hash");

-- The password-reset token was never indexed even though the reset route looks
-- rows up by it. Cheap to add while we are here.
CREATE INDEX IF NOT EXISTS "agents_password_reset_token_idx" ON "agents" ("password_reset_token");

-- One-time guard for the Launch button (D7): records when the bulk invite send
-- ran, so a second click cannot mass-re-email the roster.
ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "launch_invites_sent_at" timestamp;

-- Backfill the hash for tokens already in circulation, so a link in an email an
-- agent received yesterday still resolves after this deploys. The raw column is
-- cleared in the same statement — the hash is now the lookup key, and keeping
-- the plaintext would defeat the point of hashing it.
--
-- Uses the BUILT-IN sha256() (core since PostgreSQL 11), NOT pgcrypto's
-- digest(). An earlier version guarded a digest() call with an EXISTS check on
-- pg_extension, but Postgres resolves the function during parse analysis — before
-- any WHERE runs — so on a database without pgcrypto the statement failed to
-- parse and rolled the whole migration back instead of no-op'ing. This chain
-- never installs pgcrypto, so that was every fresh setup (CI, a new Neon branch,
-- local, full-setup.sql). sha256(convert_to(token,'UTF8')) hex-encoded equals
-- lib/agentPortalAuth.hashToken() exactly, so the stored hashes match what the
-- login path looks up.
UPDATE "agents"
   SET "magic_link_token_hash" = encode(sha256(convert_to("magic_link_token", 'UTF8')), 'hex'),
       "magic_link_token" = NULL
 WHERE "magic_link_token" IS NOT NULL
   AND "magic_link_token_hash" IS NULL;

-- Agents are never locked out regardless: an unresolvable link lands on the
-- "request a new link" page, and lib/agentMagicLink.ts re-issues a hashed token
-- on next use (D6).
