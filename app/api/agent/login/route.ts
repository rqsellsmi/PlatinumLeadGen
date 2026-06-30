/**
 * POST /api/agent/login — magic-link token, email+password, or request-link.
 * (Section 9.1)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { setAgentSessionCookie } from '@/lib/agentSession';
import {
  generateMagicLinkToken,
  magicLinkExpiry,
  isTokenExpired,
} from '@/lib/agentPortalAuth';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { token?: string; email?: string; password?: string; requestLink?: boolean }
      | null;
    if (!body) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    // --- Magic-link token login -------------------------------------------
    if (body.token) {
      const rows = await db
        .select()
        .from(agents)
        .where(eq(agents.magicLinkToken, body.token))
        .limit(1);
      const agent = rows[0];
      if (
        agent &&
        agent.isActive &&
        !isTokenExpired(agent.magicLinkExpiresAt)
      ) {
        await setAgentSessionCookie(agent.id);
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    // --- Request a fresh magic link ---------------------------------------
    if (body.requestLink && body.email) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(eq(agents.email, body.email), eq(agents.isActive, true)))
        .limit(1);
      const agent = rows[0];
      if (agent) {
        const now = new Date();
        const token = generateMagicLinkToken();
        await db
          .update(agents)
          .set({ magicLinkToken: token, magicLinkExpiresAt: magicLinkExpiry(now), updatedAt: now })
          .where(eq(agents.id, agent.id));

        const link = `${siteUrl()}/agent/login?token=${token}`;
        await sendEmail({
          to: agent.email,
          subject: 'Your RE/MAX Platinum agent portal link',
          html: `<p>Hi ${agent.firstName},</p>
<p>Use the link below to sign in to your agent portal. It expires in 30 days.</p>
<p><a href="${link}">Sign in to the agent portal</a></p>
<p>If you did not request this, you can ignore this email.</p>`,
          text: `Hi ${agent.firstName},\n\nSign in to your agent portal: ${link}\n\nThe link expires in 30 days. If you did not request this, ignore this email.`,
        });
      }
      // Always succeed — never leak whether the email matched an agent.
      return NextResponse.json({ success: true });
    }

    // --- Email + password login -------------------------------------------
    if (body.email && body.password) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(eq(agents.email, body.email), eq(agents.isActive, true)))
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
