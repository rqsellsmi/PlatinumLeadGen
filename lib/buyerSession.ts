/**
 * Server-side helpers for the buyer session cookie (Route Handlers + Server
 * Components). Mirrors lib/agentSession.ts, with its own cookie + scoping.
 */
import { cookies } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { BUYER_SESSION_COOKIE, createBuyerSession, verifyBuyerSession } from './buyerPortalAuth';
import { db } from './db';
import { buyerUsers, type BuyerUser } from '../drizzle/schema';

/** Read + verify the buyer session cookie; returns buyerUserId or null. */
export async function getBuyerUserId(): Promise<number | null> {
  const store = await cookies();
  return verifyBuyerSession(store.get(BUYER_SESSION_COOKIE)?.value);
}

/** Load the current signed-in buyer (non-deleted), or null. */
export async function getCurrentBuyer(): Promise<BuyerUser | null> {
  const id = await getBuyerUserId();
  if (!id) return null;
  const rows = await db
    .select()
    .from(buyerUsers)
    .where(and(eq(buyerUsers.id, id), isNull(buyerUsers.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Set the signed buyer session cookie (httpOnly, 30-day rolling). */
export async function setBuyerSessionCookie(buyerUserId: number): Promise<void> {
  const { value, maxAge } = createBuyerSession(buyerUserId);
  const store = await cookies();
  store.set(BUYER_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/** Clear the buyer session cookie (sign out / delete account). */
export async function clearBuyerSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(BUYER_SESSION_COOKIE);
}
