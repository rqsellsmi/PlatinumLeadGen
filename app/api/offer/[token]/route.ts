/**
 * GET /api/offer/[token]?response=accept|decline — agent accept/decline links. (Section 7.4)
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, agents } from '@/drizzle/schema';
import { applyScore, type ScoreReason } from '@/lib/scoring';
import { reassignLead } from '@/lib/autoOffer';
import { agentAcceptanceEmail, sendEmail } from '@/lib/email';
import { setAgentSessionCookie } from '@/lib/agentSession';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { logLeadEvent } from '@/lib/leadEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
}

function htmlPage(title: string, message: string, status: number, ctaHref?: string): NextResponse {
  const cta = ctaHref
    ? `<p style="margin-top:24px;"><a href="${ctaHref}" style="display:inline-block;background:#1E3A5F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;">Go to the agent portal</a></p>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fa;color:#1a1a1a;">
  <div style="max-width:560px;margin:64px auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <div style="background:#1E3A5F;padding:20px 28px;color:#fff;font-size:20px;font-weight:bold;">RE/MAX Platinum</div>
    <div style="padding:32px 28px;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#1E3A5F;">${title}</h1>
      <p style="font-size:16px;line-height:1.5;">${message}</p>
      ${cta}
    </div>
  </div>
</body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html' } });
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'offer'))) {
      return htmlPage('Too many requests', 'Please wait a moment and try your link again.', 429);
    }
    const url = new URL(req.url);
    const response = url.searchParams.get('response');
    const token = params.token;

    const rows = await db.select().from(leadOffers).where(eq(leadOffers.offerToken, token)).limit(1);
    const offer = rows[0];
    const now = new Date();

    if (!offer || (offer.tokenExpiresAt && offer.tokenExpiresAt.getTime() < now.getTime())) {
      return htmlPage(
        'This link is no longer active',
        'This offer link is invalid, expired, or was superseded by a newer assignment. ' +
          'Sign in to the agent portal to see the leads currently assigned to you.',
        400,
        `${siteUrl()}/agent/login`,
      );
    }

    if (response === 'decline') {
      // Decline is idempotent — already-resolved offers just confirm.
      if (offer.status !== 'offered') {
        return htmlPage(
          'Already responded',
          'Thanks — this lead has already been reassigned. No further action is needed.',
          200,
        );
      }

      await db
        .update(leadOffers)
        .set({ status: 'declined', declinedAt: now, respondedAt: now, updatedAt: now })
        .where(eq(leadOffers.id, offer.id));

      try {
        // Decline penalty is -3.00 (§E.4 / §J), defined in SCORE_DELTAS.
        await applyScore({
          agentId: offer.agentId,
          reason: 'system_decline',
          leadId: offer.leadId,
          leadOfferId: offer.id,
        });
      } catch (err) {
        console.error('[api/offer] decline applyScore failed:', err);
      }

      await logLeadEvent(offer.leadId, 'offer_declined', null);

      try {
        await reassignLead(offer.leadId);
      } catch (err) {
        console.error('[api/offer] reassignLead failed:', err);
      }

      return htmlPage(
        'Thanks',
        'You declined this lead. It has been reassigned to another agent. No further action is needed.',
        200,
      );
    }

    if (response === 'accept') {
      if (offer.status !== 'offered') {
        return htmlPage(
          'Already responded',
          'This lead offer has already been responded to. If you accepted it, open the agent portal to manage it.',
          200,
          `${siteUrl()}/agent/login`,
        );
      }

      await db
        .update(leadOffers)
        .set({ status: 'accepted', acceptedAt: now, respondedAt: now, tokenUsedAt: now, updatedAt: now })
        .where(eq(leadOffers.id, offer.id));

      await db
        .update(leads)
        .set({ acceptedAt: now, lastStatusChangedAt: now, updatedAt: now })
        .where(eq(leads.id, offer.leadId));

      // Response-time score, 4 bands (§E.3). A null offerSentAt (queued offer
      // dispatched asynchronously) is treated as the top tier — not the agent's
      // fault the timestamp was missing.
      {
        let reason: ScoreReason = 'system_response_fast';
        let explicitDelta: number | undefined;
        if (offer.offerSentAt) {
          const elapsed = now.getTime() - offer.offerSentAt.getTime();
          if (elapsed < FIFTEEN_MIN_MS) {
            reason = 'system_response_fast'; // +10
          } else if (elapsed <= THIRTY_MIN_MS) {
            reason = 'system_response_fast';
            explicitDelta = 7.65; // 15–30 min tier
          } else if (elapsed <= ONE_HOUR_MS) {
            reason = 'system_response_good'; // +5
          } else {
            reason = 'system_response_slow'; // +2 (>= 60 min)
          }
        }
        try {
          await applyScore({
            agentId: offer.agentId,
            reason,
            delta: explicitDelta,
            leadId: offer.leadId,
            leadOfferId: offer.id,
          });
        } catch (err) {
          console.error('[api/offer] accept applyScore failed:', err);
        }
      }

      await logLeadEvent(offer.leadId, 'offer_accepted', null);

      // Send the agent the full contact details.
      try {
        const detailRows = await db
          .select({ lead: leads, agent: agents })
          .from(leads)
          .innerJoin(agents, eq(agents.id, offer.agentId))
          .where(eq(leads.id, offer.leadId))
          .limit(1);
        const detail = detailRows[0];
        if (detail) {
          const { lead, agent } = detail;
          const leadName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'New lead';
          await sendEmail(
            agentAcceptanceEmail({
              to: agent.email,
              agentName: `${agent.firstName} ${agent.lastName}`.trim(),
              leadName,
              leadEmail: lead.email,
              leadPhone: lead.phone,
              propertyAddress: lead.propertyAddress,
              portalUrl: `${siteUrl()}/agent/leads`,
            }),
          );
        }
      } catch (err) {
        console.error('[api/offer] acceptance email failed:', err);
      }

      try {
        await setAgentSessionCookie(offer.agentId);
      } catch (err) {
        console.error('[api/offer] setAgentSessionCookie failed:', err);
      }

      return NextResponse.redirect(new URL('/agent/leads', req.url));
    }

    return htmlPage(
      'Invalid request',
      'Please use the Accept or Decline link from your lead offer email.',
      400,
    );
  } catch (err) {
    console.error('[api/offer] error:', err);
    return htmlPage(
      'Something went wrong',
      'We could not process your response. Please try again or contact your broker.',
      500,
    );
  }
}
