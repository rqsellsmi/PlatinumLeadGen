/**
 * Middleware (Section 11.2 / 13.2).
 * - Protects /admin/* via NextAuth session (except /admin/login).
 * - Protects /agent/* via the signed agent session cookie (except /agent/login).
 * - Validates same-origin for internal /api/leads/* POSTs.
 *
 * Uses the edge-safe Web Crypto verifier for the agent session so no node:crypto
 * or DB call is needed here.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { AGENT_SESSION_COOKIE, verifyAgentSessionEdge } from './lib/agentSessionEdge';
import { BUYER_SESSION_COOKIE, verifyBuyerSessionEdge } from './lib/buyerSessionEdge';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Admin: NextAuth session cookie presence check ------------------------
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const hasSession =
      req.cookies.has('authjs.session-token') ||
      req.cookies.has('__Secure-authjs.session-token');
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(url);
    }
  }

  // --- Agent portal: signed session cookie ----------------------------------
  // Public agent pages: login, first-time setup, and the emailed reset page.
  if (
    pathname.startsWith('/agent') &&
    pathname !== '/agent/login' &&
    pathname !== '/agent/set-password' &&
    pathname !== '/agent/reset-password'
  ) {
    const cookie = req.cookies.get(AGENT_SESSION_COOKIE)?.value;
    const secret = process.env.NEXTAUTH_SECRET ?? '';
    const agentId = await verifyAgentSessionEdge(cookie, secret);
    if (!agentId) {
      const url = req.nextUrl.clone();
      url.pathname = '/agent/login';
      return NextResponse.redirect(url);
    }
  }

  // --- Buyer account: signed session cookie (its own isolated principal) -----
  // /account/* pages require a buyer session; unauthenticated → home with a
  // sign-in hint. The admin/agent guards above never accept this cookie, and this
  // guard never accepts theirs.
  if (pathname.startsWith('/account')) {
    const cookie = req.cookies.get(BUYER_SESSION_COOKIE)?.value;
    const secret = process.env.BUYER_SESSION_SECRET || process.env.NEXTAUTH_SECRET || '';
    const buyerId = await verifyBuyerSessionEdge(cookie, secret);
    if (!buyerId) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.searchParams.set('signin', '1');
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  // --- Internal lead + buyer API: same-origin only --------------------------
  if (
    pathname.startsWith('/api/leads') ||
    pathname === '/api/appointments' ||
    pathname === '/api/buyer/inquiry' ||
    (pathname.startsWith('/api/buyer/') && !pathname.startsWith('/api/buyer/auth/'))
  ) {
    if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
      const origin = req.headers.get('origin');
      const host = req.headers.get('host');
      // Allow same-origin browser calls and server-side calls (no Origin header).
      if (origin && host && new URL(origin).host !== host) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/agent/:path*',
    '/account/:path*',
    '/api/leads/:path*',
    '/api/appointments',
    '/api/buyer/:path*',
  ],
};
