/**
 * Buyer account find-or-create — shared by the Google and magic-link callbacks.
 * Email is the identity key (always lowercased). A verified email is required
 * before any agent-notify (both sign-in methods verify: Google returns
 * email_verified; a magic-link click proves inbox control).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { buyerUsers, type BuyerUser } from '../drizzle/schema';

export async function findBuyerByEmail(email: string): Promise<BuyerUser | null> {
  const e = email.trim().toLowerCase();
  const rows = await db
    .select()
    .from(buyerUsers)
    .where(and(sql`lower(${buyerUsers.email}) = ${e}`, isNull(buyerUsers.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findOrCreateBuyer(input: {
  email: string;
  name?: string | null;
  googleSub?: string | null;
}): Promise<BuyerUser> {
  const email = input.email.trim().toLowerCase();
  const now = new Date();

  const existingRows = await db
    .select()
    .from(buyerUsers)
    .where(sql`lower(${buyerUsers.email}) = ${email}`)
    .limit(1);
  const existing = existingRows[0];

  if (existing) {
    const patch = {
      emailVerifiedAt: existing.emailVerifiedAt ?? now,
      lastSeenAt: now,
      deletedAt: null, // re-login reactivates a previously-deleted account
      name: input.name ?? existing.name,
      googleSub: input.googleSub ?? existing.googleSub,
    };
    await db.update(buyerUsers).set(patch).where(eq(buyerUsers.id, existing.id));
    return { ...existing, ...patch };
  }

  const inserted = await db
    .insert(buyerUsers)
    .values({
      email,
      name: input.name ?? null,
      googleSub: input.googleSub ?? null,
      emailVerifiedAt: now,
      lastSeenAt: now,
      createdAt: now,
    })
    .returning();
  return inserted[0];
}
