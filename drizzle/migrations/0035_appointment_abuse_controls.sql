-- P0.3 — abuse controls on the public appointment endpoint (review #10/#11, D5).
--
-- `idempotency_key`: a client-generated key so a double-tap or a retried fetch
-- produces one appointment, one timeline event and one agent email rather than
-- three of each. Not UNIQUE on purpose — the route scopes the dedup check to a
-- short recency window, and a hard constraint would reject a genuine second
-- request months later from a client that reused a key.
--
-- `abuse_flag`: which cheap signal looked wrong (currently 'too_fast'). The
-- interim controls deliberately FLAG rather than block (D5 MODIFIED), because a
-- false positive silently discards a seller lead we paid Google for. This
-- column is what makes the flagged volume visible, which is also the evidence
-- for the Turnstile tripwire.
--
-- Hand-authored and idempotent — never `drizzle-kit generate` (lessons-learned §1).

ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(100);
ALTER TABLE "appointment_requests" ADD COLUMN IF NOT EXISTS "abuse_flag" varchar(40);

CREATE INDEX IF NOT EXISTS "appointment_requests_idempotency_idx"
  ON "appointment_requests" ("idempotency_key");

-- Same flag on leads, for the partial/submit endpoints.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "abuse_flag" varchar(40);
