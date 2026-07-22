/**
 * POST /api/agent/password/request — "Forgot password". Body: { email }.
 * If the email is on the agent roster, emails THAT agent a short-lived reset
 * link. Always returns success (never reveals whether the email matched) so the
 * flow is email-verified — only the inbox owner can complete the reset.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ilike, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { generatePasswordResetToken, passwordResetExpiry } from '@/lib/agentPortalAuth';
import { sendEmail, agentPasswordResetEmail } from '@/lib/email';
import { siteUrl } from '@/lib/siteUrl';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'agent_login'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    const email = (body?.email ?? '').trim();

    if (email) {
      const rows = await db.select().from(agents).where(ilike(agents.email, email)).limit(1);
      const agent = rows[0];
      if (agent) {
        const now = new Date();
        const token = generatePasswordResetToken();
        await db
          .update(agents)
          .set({
            passwordResetToken: token,
            passwordResetExpiresAt: passwordResetExpiry(now),
            updatedAt: now,
          })
          .where(eq(agents.id, agent.id));

        await sendEmail(
          agentPasswordResetEmail({
            to: agent.email,
            agentName: `${agent.firstName} ${agent.lastName}`.trim() || 'there',
            resetUrl: `${siteUrl()}/agent/reset-password?token=${token}`,
            relatedAgentId: agent.id,
          }),
        );
      }
    }

    // Never leak whether the email matched an agent.
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/agent/password/request] error:', err);
    // Still respond success so the UI shows the same neutral message.
    return NextResponse.json({ success: true });
  }
}
