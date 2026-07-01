/**
 * Lead deduplication (v1.6 §D).
 *  - Layer 1: contact dedup by email (case-insensitive) or phone (digits only).
 *  - Layer 2: cross-session address dedup via normalizedAddress.
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

/** Layer 2: find a non-deleted lead with the same normalized address. */
export async function findLeadByAddress(address: string): Promise<Lead | null> {
  const normalized = normalizedAddressKey(address);
  if (!normalized) return null;
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.isDeleted, false), eq(leads.normalizedAddress, normalized)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
