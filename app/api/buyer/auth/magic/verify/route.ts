/**
 * GET /api/buyer/auth/magic/verify?token=… — the emailed-link click. Verifies the
 * single-use token, verifies the email, sets the buyer session, and redirects.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { buyerAuthTokens } from '@/drizzle/schema';
import {
  BUYER_SESSION_COOKIE,
  createBuyerSession,
  hashToken,
  isExpired,
} from '@/lib/buyerPortalAuth';
import { findOrCreateBuyer } from '@/lib/buyerAccount';
import { siteUrl } from '@/lib/siteUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

export async function GET(req: NextRequest) {
  const base = siteUrl();
  const token = req.nextUrl.searchParams.get('token');
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const fail = () => NextResponse.redirect(new URL('/?signin=error', base));

  if (!token) return fail();
  try {
    const rows = await db
      .select()
      .from(buyerAuthTokens)
      .where(eq(buyerAuthTokens.tokenHash, hashToken(token)))
      .limit(1);
    const row = rows[0];
    if (!row || row.usedAt || isExpired(row.expiresAt)) return fail();

    await db.update(buyerAuthTokens).set({ usedAt: new Date() }).where(eq(buyerAuthTokens.id, row.id));
    const user = await findOrCreateBuyer({ email: row.email });

    const { value, maxAge } = createBuyerSession(user.id);
    const res = NextResponse.redirect(new URL(next, base));
    res.cookies.set(BUYER_SESSION_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return res;
  } catch (err) {
    console.error('[buyer/magic/verify] error:', err);
    return fail();
  }
}
