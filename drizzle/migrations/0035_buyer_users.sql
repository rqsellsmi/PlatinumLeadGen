-- Buyer accounts (passwordless): a third, isolated principal alongside admin +
-- agents. No credentials stored — Google OAuth + email magic link only. Activity
-- (favorites/searches/views) and the account↔lead link come in later migrations.
-- Hand-authored, idempotent.

CREATE TABLE IF NOT EXISTS "buyer_users" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(200) NOT NULL,
  "name" varchar(200),
  "google_sub" varchar(255),
  "email_verified_at" timestamp,
  "phone" varchar(40),
  "represented_elsewhere" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
-- Unique by lowercased email (application always stores lowercase).
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_users_email_idx" ON "buyer_users" (lower("email"));

CREATE TABLE IF NOT EXISTS "buyer_auth_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(200) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "buyer_auth_tokens_hash_idx" ON "buyer_auth_tokens" ("token_hash");
