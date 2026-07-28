/**
 * GET /api/buyer/auth/google/callback — finish the Google OAuth flow: verify the
 * CSRF state, exchange the code server-side, read the verified email from Google's
 * userinfo, find-or-create the buyer, set the session, and redirect.
 */
import { NextRequest, NextResponse } from 'next/server';
import { BUYER_SESSION_COOKIE, createBuyerSession } from '@/lib/buyerPortalAuth';
import { findOrCreateBuyer } from '@/lib/buyerAccount';
import { requestOrigin } from '@/lib/siteUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'bx_oauth_state';

function safeNext(next: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

export async function GET(req: NextRequest) {
  // Same origin as /start used — Google called back to this host, so the token
  // exchange's redirect_uri and the post-login redirect both stay on it.
  const base = requestOrigin(req.headers);
  const fail = () => {
    const res = NextResponse.redirect(new URL('/?signin=error', base));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!code || !state || !cookieState || !clientId || !clientSecret) return fail();
  const [savedState, savedNext = '/account'] = cookieState.split('|');
  if (state !== savedState) return fail(); // CSRF

  try {
    // Exchange the authorization code for tokens (server-to-server, with secret).
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${base}/api/buyer/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail();
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail();

    // The email from Google's userinfo is trusted (came over TLS via our secret).
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return fail();
    const info = (await infoRes.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
      sub?: string;
    };
    if (!info.email || info.email_verified === false) return fail();

    const user = await findOrCreateBuyer({
      email: info.email,
      name: info.name ?? null,
      googleSub: info.sub ?? null,
    });

    const { value, maxAge } = createBuyerSession(user.id);
    const res = NextResponse.redirect(new URL(safeNext(savedNext), base));
    res.cookies.delete(STATE_COOKIE);
    res.cookies.set(BUYER_SESSION_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return res;
  } catch (err) {
    console.error('[buyer/google/callback] error:', err);
    return fail();
  }
}
