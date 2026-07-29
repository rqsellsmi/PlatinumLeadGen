/**
 * POST /api/agent/set-password — first-time account setup via a per-agent invite.
 *
 * P0.8a (review #17/#70, decision D7). This route used to be gated by a SHARED
 * brokerage setup code plus a rostered email address. That meant:
 *   - one secret, typed into the admin UI and distributed out of band, was the
 *     only thing standing between anyone who learned it and any agent account
 *     that had not yet set a password;
 *   - a shared secret inevitably circulates, and it proves nothing about who is
 *     using it — it never demonstrated control of the agent's inbox;
 *   - INACTIVE agents were explicitly eligible, so a departed agent's account
 *     could be claimed.
 *
 * It now requires a single-use, expiring invite token that was emailed to the
 * address on the roster, so completing setup proves control of that inbox. Same
 * shape as the existing password-reset flow, which already worked this way.
 *
 * Still does NOT sign the agent in — they use the login page afterwards.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { hashToken, isTokenExpired } from '@/lib/agentPortalAuth';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { sendEmail, adminAlertEmail } from '@/lib/email';

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

    // Look the invite up by hash — the plaintext is only ever in the email.
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.inviteTokenHash, hashToken(token)))
      .limit(1);
    const agent = rows[0];
    if (!agent || isTokenExpired(agent.inviteExpiresAt)) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    // A departed agent's invite must not be redeemable, however it was obtained.
    if (!agent.isActive) {
      return NextResponse.json({ error: 'inactive' }, { status: 403 });
    }

    // First-time setup ONLY. Once a password exists it can only be changed
    // through the email-verified "forgot password" flow, so a stale invite can
    // never overwrite a live credential.
    if (agent.passwordHash) {
      return NextResponse.json({ error: 'already_set' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .update(agents)
      .set({
        passwordHash,
        // Consume the invite: single-use by construction, not by convention.
        inviteTokenHash: null,
        inviteExpiresAt: null,
        inviteAcceptedAt: new Date(),
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

    // Tell the broker an account was set up (#70). Best-effort — a failed
    // notification must not fail the agent's setup.
    try {
      await sendEmail(
        adminAlertEmail(
          'Agent portal account set up',
          `${agent.firstName} ${agent.lastName} (${agent.email}) has completed their agent portal setup.`,
        ),
      );
    } catch (err) {
      console.error('[api/agent/set-password] broker notification failed:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/set-password] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
