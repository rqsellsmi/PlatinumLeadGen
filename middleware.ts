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

  // --- Internal lead API: same-origin only ----------------------------------
  if (pathname.startsWith('/api/leads') || pathname === '/api/appointments') {
    if (req.method === 'POST') {
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
  matcher: ['/admin/:path*', '/agent/:path*', '/api/leads/:path*', '/api/appointments'],
};
