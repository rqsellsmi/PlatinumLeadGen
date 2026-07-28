/**
 * GET /api/buyer/auth/google/start — begin the Google OAuth 2.0 code flow.
 * Stores a CSRF `state` (+ the post-login destination) in a short-lived cookie
 * and redirects to Google. No-op (redirect home) when Google isn't configured.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requestOrigin } from '@/lib/siteUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'bx_oauth_state';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

export async function GET(req: NextRequest) {
  // Build the OAuth origin from THIS request so Google returns to the same
  // deployment (preview/prod), not the canonical production domain.
  const base = requestOrigin(req.headers);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL('/?signin=google_unavailable', base));

  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${base}/api/buyer/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set(STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });
  return res;
}
