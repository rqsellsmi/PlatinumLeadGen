/**
 * POST /api/agent/login — magic-link token, email+password, or request-link.
 * (Section 9.1; P0.8a / D6)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or, ilike } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { setAgentSessionCookie } from '@/lib/agentSession';
import { hashToken, isTokenExpired, magicLinkExpiry } from '@/lib/agentPortalAuth';
import { issueMagicLinkToken } from '@/lib/agentMagicLink';
import { siteUrl } from '@/lib/siteUrl';
import { sendEmail, agentMagicLinkEmail } from '@/lib/email';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'agent_login'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = (await req.json().catch(() => null)) as
      | { token?: string; email?: string; password?: string; requestLink?: boolean }
      | null;
    if (!body) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    // --- Magic-link token login -------------------------------------------
    if (body.token) {
      // Look up by HASH (D6). The plaintext column is still matched as a
      // fallback so links from emails delivered before migration 0036 keep
      // working; new tokens are only ever stored hashed.
      const tokenHash = hashToken(body.token);
      const rows = await db
        .select()
        .from(agents)
        .where(
          or(eq(agents.magicLinkTokenHash, tokenHash), eq(agents.magicLinkToken, body.token)),
        )
        .limit(1);
      const agent = rows[0];
      if (agent && agent.isActive && !isTokenExpired(agent.magicLinkExpiresAt)) {
        // Rotate on use: the presented token is consumed and replaced. A link
        // that is copied, forwarded, logged or intercepted after the agent has
        // used it is already dead. (The owner kept the 14-day TTL, D6 REVISED,
        // so rotation is what limits a leaked URL's useful life in practice.)
        await issueMagicLinkToken(agent.id);
        await setAgentSessionCookie(agent.id);
        return NextResponse.json({ success: true });
      }
      // A valid token for a deactivated agent — say so instead of "expired"
      // (common while the roster is seeded inactive).
      if (agent && !agent.isActive) {
        return NextResponse.json({ error: 'inactive' }, { status: 403 });
      }
      // Expired / superseded / unknown. The login page turns this into the
      // "request a new link or sign in with your password" state rather than a
      // dead end (D6).
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    // --- Request a fresh magic link ---------------------------------------
    if (body.requestLink && body.email) {
      // ilike, not eq: the reset flow already matches case-insensitively, and
      // an agent typing "Firstname.Lastname@..." should not silently get
      // nothing back.
      const rows = await db
        .select()
        .from(agents)
        .where(and(ilike(agents.email, body.email), eq(agents.isActive, true)))
        .limit(1);
      const agent = rows[0];
      if (agent) {
        const token = await issueMagicLinkToken(agent.id);
        await sendEmail(
          agentMagicLinkEmail({
            to: agent.email,
            agentName: agent.firstName,
            loginUrl: `${siteUrl()}/agent/login?token=${token}`,
            expiresAt: magicLinkExpiry(),
            relatedAgentId: agent.id,
          }),
        );
      }
      // Always succeed — never leak whether the email matched an agent.
      return NextResponse.json({ success: true });
    }

    // --- Email + password login -------------------------------------------
    if (body.email && body.password) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(ilike(agents.email, body.email), eq(agents.isActive, true)))
        .limit(1);
      const agent = rows[0];
      if (agent && agent.passwordHash) {
        const ok = await bcrypt.compare(body.password, agent.passwordHash);
        if (ok) {
          await setAgentSessionCookie(agent.id);
          return NextResponse.json({ success: true });
        }
      }
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }

    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  } catch (err) {
    console.error('[api/agent/login] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
