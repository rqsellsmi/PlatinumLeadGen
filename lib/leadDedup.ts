/**
 * Lead deduplication.
 *
 * Contact dedup only, by email (case-insensitive) or phone (digits only). The
 * old cross-session ADDRESS dedup was removed in P0.1/D3 — a shared address
 * proves nothing about identity and handed back the prior lead's report token.
 * `normalizedAddressKey` remains: the address is still normalized to clean up
 * a lead's own partials and to record valuation runs, never to match people.
 */
import { and, desc, eq, or, ilike, sql } from 'drizzle-orm';
// (ilike is used for case-insensitive email matching)
import { db } from './db';
import { leads, type Lead } from '../drizzle/schema';
import { normalizeAddress } from './addressNormalization';

/** Normalize an address to the dedup key used in the leads.normalizedAddress column. */
export function normalizedAddressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const key = normalizeAddress(address).full;
  return key && key.length >= 5 ? key : null;
}

/** Layer 1: find a non-deleted lead matching the same email or phone. */
export async function findExistingLeadByContact(
  email: string | null,
  phone: string | null,
): Promise<Lead | null> {
  const normalizedPhone = phone ? phone.replace(/\D/g, '') : null;
  const phoneUsable = normalizedPhone != null && normalizedPhone.length >= 7;
  if (!email && !phoneUsable) return null;

  const where = and(
    eq(leads.isDeleted, false),
    or(
      email ? ilike(leads.email, email) : sql`false`,
      phoneUsable
        ? sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g') = ${normalizedPhone}`
        : sql`false`,
    ),
  );

  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
