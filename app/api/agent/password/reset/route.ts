/**
 * POST /api/agent/password/reset — complete an emailed "Forgot password" reset.
 * Body: { token, password }. Validates the reset token + expiry, sets the new
 * password, and clears the token. Does NOT sign the agent in — they use the
 * login page afterward.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { hashToken, isTokenExpired } from '@/lib/agentPortalAuth';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'agent_login'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = (await req.json().catch(() => null)) as
      | { token?: string; password?: string }
      | null;
    const token = (body?.token ?? '').trim();
    const password = body?.password ?? '';

    if (!token || !password) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: 'weak_password' }, { status: 400 });
    }

    // Look the reset token up by HASH — the plaintext only ever lives in the
    // email (P0.8).
    const tokenHash = hashToken(token);
    const rows = await db.select().from(agents).where(eq(agents.passwordResetToken, tokenHash)).limit(1);
    const agent = rows[0];
    if (!agent || isTokenExpired(agent.passwordResetExpiresAt)) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 12);

    // Consume the token ATOMICALLY (P0.8): the UPDATE only matches while the
    // hashed token is still present and unexpired, so of two concurrent resets
    // exactly one row is affected — the first nulls the token, the second
    // matches nothing. RETURNING tells us which happened.
    const consumed = await db
      .update(agents)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        // Revoke every existing session (review #18). A password reset is
        // frequently a response to "someone may have my account" — leaving the
        // attacker's 7-day cookie and 14-day magic link working would defeat
        // the point of resetting at all. `revokeAgentSessions` bumps the
        // session version AND clears the magic link.
        sessionVersion: sql`${agents.sessionVersion} + 1`,
        magicLinkToken: null,
        magicLinkTokenHash: null,
        magicLinkExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(agents.id, agent.id),
          eq(agents.passwordResetToken, tokenHash),
          gt(agents.passwordResetExpiresAt, now),
        ),
      )
      .returning({ id: agents.id });

    if (consumed.length === 0) {
      // Lost the race (or the token expired in the gap): it was already used.
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/password/reset] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
