/**
 * Lead deduplication (D3, email-primary identity model).
 *
 * EMAIL is the identity key. A new submission is the same lead as an existing
 * one only when the normalized email matches exactly — a matching phone alone
 * is NOT enough to merge, because numbers are shared, recycled and mistyped. A
 * different email is therefore always a different lead.
 *
 * PHONE is kept only as a duplicate HINT: when a new lead's phone matches a
 * different-email lead, routing still treats it as its own lead, but the admin
 * (who can see every lead, unlike an agent) is alerted to check whether it is
 * the same seller with a new email or just a shared number — see
 * lib/leadDuplicateAlert.ts.
 *
 * The old cross-session ADDRESS dedup was removed in P0.1/D3 — a shared address
 * proves nothing about identity and handed back the prior lead's report token.
 * `normalizedAddressKey` remains: the address is still normalized to clean up a
 * lead's own partials and to record valuation runs, never to match people.
 */
import { and, desc, eq, ne, ilike, sql } from 'drizzle-orm';
import { db } from './db';
import { leads, type Lead } from '../drizzle/schema';
import { normalizeAddress } from './addressNormalization';
import { normalizedPhoneKey } from './contactNormalization';

/** Normalize an address to the dedup key used in the leads.normalizedAddress column. */
export function normalizedAddressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const key = normalizeAddress(address).full;
  return key && key.length >= 5 ? key : null;
}

/**
 * The identity lookup: a non-deleted lead whose email matches (case-insensitive)
 * — the ONLY signal that says "this is the same person" (D3, email-primary).
 * Returns null when no email is given, so a contact-less submission never
 * matches an existing lead by identity.
 */
export async function findLeadByEmail(email: string | null): Promise<Lead | null> {
  if (!email) return null;
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.isDeleted, false), ilike(leads.email, email)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The duplicate HINT lookup: a non-deleted lead whose phone matches exactly
 * (digits only), optionally excluding one lead id (the just-created lead). Used
 * only to raise the admin heads-up — never to merge or attach.
 */
export async function findLeadByPhone(
  phone: string | null,
  excludeLeadId?: number,
): Promise<Lead | null> {
  const normalizedPhone = normalizedPhoneKey(phone);
  if (!normalizedPhone) return null;

  const rows = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.isDeleted, false),
        excludeLeadId != null ? ne(leads.id, excludeLeadId) : undefined,
        sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g') = ${normalizedPhone}`,
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
