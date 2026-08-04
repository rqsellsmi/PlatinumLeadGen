-- Appointment-request lead type (D4 continuation).
--
-- The public appointment-request form can now be the FIRST touch: when it is
-- reached without a valid report token, the endpoint creates a lead from the
-- submitted details instead of orphaning the request. Those leads get their own
-- lead_type so acquisition reporting can tell an appointment-origin lead from a
-- valuation or guide lead (its website conversion is `appointment_lead`).
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction on v12+ as long
-- as the new value is not USED in the same transaction — it isn't here; the
-- first insert happens later at runtime — so this is safe under drizzle-kit's
-- transactional runner. IF NOT EXISTS keeps it idempotent (lessons-learned §1).

ALTER TYPE "public"."lead_type" ADD VALUE IF NOT EXISTS 'appointment';
