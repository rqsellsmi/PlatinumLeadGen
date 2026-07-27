/**
 * POST /api/buyer/account/delete — the buyer's right to delete their account.
 * Soft-deletes the buyer_users row (deleted_at), hard-deletes their favorites,
 * saved searches, and view history, and UNLINKS any lead (buyer_user_id → null)
 * while keeping the CRM lead record itself (O3 — a lead already shared with an
 * agent is a business record). Clears the session cookie. Session-scoped;
 * same-origin guarded in middleware.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { buyerFavorites, buyerListingViews, buyerSavedSearches, buyerUsers, leads } from '@/drizzle/schema';
import { getBuyerUserId, clearBuyerSessionCookie } from '@/lib/buyerSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    // Unlink leads first (keep the CRM record; the FK is ON DELETE SET NULL, but
    // we soft-delete the buyer rather than hard-delete, so unlink explicitly).
    await db.update(leads).set({ buyerUserId: null, updatedAt: new Date() }).where(eq(leads.buyerUserId, buyerId));

    // Hard-delete the buyer's save surfaces + activity.
    await db.delete(buyerFavorites).where(eq(buyerFavorites.buyerUserId, buyerId));
    await db.delete(buyerSavedSearches).where(eq(buyerSavedSearches.buyerUserId, buyerId));
    await db.delete(buyerListingViews).where(eq(buyerListingViews.buyerUserId, buyerId));

    // Soft-delete the account (retains the row for audit/dedup integrity but
    // getCurrentBuyer treats deleted_at as gone).
    await db
      .update(buyerUsers)
      .set({ deletedAt: new Date(), googleSub: null })
      .where(eq(buyerUsers.id, buyerId));
  } catch (err) {
    console.error('[api/buyer/account/delete] failed:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  await clearBuyerSessionCookie();
  return NextResponse.json({ ok: true });
}
