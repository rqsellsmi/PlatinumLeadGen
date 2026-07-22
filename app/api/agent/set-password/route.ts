/**
 * POST /api/agent/set-password — public first-time setup / self-service reset.
 *
 * Gated by a shared **setup code** (Admin → Settings) plus the requirement that
 * the email is on the agent roster. No emailed token, no active-status
 * requirement (an agent just needs to exist). Serves both the first password
 * and later resets ("Forgot password?" links here). Does NOT sign the agent in
 * — they use the login page afterward.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ilike, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { agents, notificationSettings } from '@/drizzle/schema';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 8;

/** Constant-time string compare (guards length leak). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'agent_login'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = (await req.json().catch(() => null)) as
      | { code?: string; email?: string; password?: string }
      | null;
    const code = (body?.code ?? '').trim();
    const email = (body?.email ?? '').trim();
    const password = body?.password ?? '';

    if (!code || !email || !password) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: 'weak_password' }, { status: 400 });
    }

    // The shared setup code must be configured AND match (fail-closed if unset).
    const settingsRows = await db
      .select({ code: notificationSettings.agentSetupCode })
      .from(notificationSettings)
      .limit(1);
    const configured = (settingsRows[0]?.code ?? '').trim();
    if (!configured) {
      return NextResponse.json({ error: 'setup_closed' }, { status: 403 });
    }
    if (!safeEqual(code, configured)) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 401 });
    }

    // The email must be on the roster (active status not required, by design).
    const agentRows = await db.select().from(agents).where(ilike(agents.email, email)).limit(1);
    const agent = agentRows[0];
    if (!agent) {
      return NextResponse.json({ error: 'email_not_found' }, { status: 404 });
    }
    // First-time setup ONLY. Once a password exists, this code-gated public page
    // can't overwrite it — the agent must use the email-verified "Forgot
    // password" flow so only the inbox owner can reset it.
    if (agent.passwordHash) {
      return NextResponse.json({ error: 'already_set' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .update(agents)
      .set({ passwordHash, passwordResetToken: null, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/set-password] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
