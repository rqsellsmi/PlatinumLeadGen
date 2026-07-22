/**
 * POST /api/agent/password/reset — complete an emailed "Forgot password" reset.
 * Body: { token, password }. Validates the reset token + expiry, sets the new
 * password, and clears the token. Does NOT sign the agent in — they use the
 * login page afterward.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { isTokenExpired } from '@/lib/agentPortalAuth';
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

    const rows = await db.select().from(agents).where(eq(agents.passwordResetToken, token)).limit(1);
    const agent = rows[0];
    if (!agent || isTokenExpired(agent.passwordResetExpiresAt)) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .update(agents)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/password/reset] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
