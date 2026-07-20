/**
 * Agent accept/decline links (Section 7.4).
 *
 * IMPORTANT — accept/decline MUST NOT happen on GET. Email security scanners and
 * link-preview bots (Outlook SafeLinks, Mimecast, Gmail prefetch, corporate
 * proxies) automatically fetch every URL in an email, which was silently
 * DECLINING offers (phantom "declined" events + "unrouted, no agent available"
 * admin alerts + wrong score penalties). So:
 *   GET  /api/offer/[token]?response=accept|decline  → a confirmation PAGE only
 *   POST /api/offer/[token]  (body response=accept|decline) → performs the action
 * Bots issue GETs and don't submit forms, so they can no longer trigger a state
 * change; the agent clicks one button to confirm.
 */
import { siteUrl } from '@/lib/siteUrl';
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

const SHELL_HEAD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">`;

function page(title: string, body: string, status = 200): NextResponse {
  const html = `${SHELL_HEAD}
<title>${title}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fa;color:#1a1a1a;">
  <div style="max-width:560px;margin:64px auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <div style="background:#1E3A5F;padding:20px 28px;color:#fff;font-size:20px;font-weight:bold;">RE/MAX Platinum</div>
    <div style="padding:32px 28px;">${body}</div>
  </div>
</body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html' } });
}

function messagePage(title: string, message: string, status: number, ctaHref?: string): NextResponse {
  const cta = ctaHref
    ? `<p style="margin-top:24px;"><a href="${ctaHref}" style="display:inline-block;background:#1E3A5F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;">Go to the agent portal</a></p>`
    : '';
  return page(
    title,
    `<h1 style="margin:0 0 12px;font-size:22px;color:#1E3A5F;">${title}</h1>
     <p style="font-size:16px;line-height:1.5;">${message}</p>${cta}`,
    status,
  );
}

/** The confirmation page — the agent clicks a button that POSTs the action.
 *  Rendering this has NO side effects, so scanners hitting the GET are harmless. */
function confirmPage(token: string, response: 'accept' | 'decline', where: string): NextResponse {
  const isAccept = response === 'accept';
  const color = isAccept ? '#1E7F4F' : '#B00020';
  const verb = isAccept ? 'Accept' : 'Decline';
  const lead = where ? ` for the lead${where}` : '';
  const note = isAccept
    ? 'Accepting opens the lead in your portal and shares the contact details.'
    : 'Declining reassigns this lead to another agent and applies a response penalty.';
  return page(
    `${verb} this lead`,
    `<h1 style="margin:0 0 12px;font-size:22px;color:#1E3A5F;">${verb} this lead${lead}?</h1>
     <p style="font-size:15px;line-height:1.5;color:#475569;">${note}</p>
     <form method="POST" action="/api/offer/${token}" style="margin-top:24px;">
       <input type="hidden" name="response" value="${response}">
       <button type="submit" style="display:inline-block;border:0;cursor:pointer;background:${color};color:#fff;padding:14px 26px;border-radius:999px;font-weight:bold;font-size:16px;">Confirm ${verb}</button>
     </form>`,
  );
}

/** Load + validate the offer for a token. Returns a page to short-circuit, or the offer. */
async function loadOffer(token: string) {
  const rows = await db.select().from(leadOffers).where(eq(leadOffers.offerToken, token)).limit(1);
  const offer = rows[0];
  const now = new Date();
  if (!offer || (offer.tokenExpiresAt && offer.tokenExpiresAt.getTime() < now.getTime())) {
    return {
      offer: null,
      short: messagePage(
        'This link is no longer active',
        'This offer link is invalid, expired, or was superseded by a newer assignment. ' +
          'Sign in to the agent portal to see the leads currently assigned to you.',
        400,
        `${siteUrl()}/agent/login`,
      ),
    };
  }
  return { offer, short: null as NextResponse | null };
}

// ---------------------------------------------------------------------------
// GET — confirmation page ONLY (no state change). Safe for email scanners.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'offer'))) {
      return messagePage('Too many requests', 'Please wait a moment and try your link again.', 429);
    }
    const response = new URL(req.url).searchParams.get('response');
    const { offer, short } = await loadOffer(params.token);
    if (short) return short;

    if (offer!.status !== 'offered') {
      return messagePage(
        'Already responded',
        'This lead offer has already been responded to. Open the agent portal to manage your leads.',
        200,
        `${siteUrl()}/agent/login`,
      );
    }

    if (response !== 'accept' && response !== 'decline') {
      return messagePage(
        'Invalid request',
        'Please use the Accept or Decline link from your lead offer email.',
        400,
      );
    }

    // Lead context for the confirmation copy (city only — no PII in the URL page).
    const leadRows = await db
      .select({ city: leads.propertyCity })
      .from(leads)
      .where(eq(leads.id, offer!.leadId))
      .limit(1);
    const city = leadRows[0]?.city;
    return confirmPage(params.token, response, city ? ` in ${city}` : '');
  } catch (err) {
    console.error('[api/offer GET] error:', err);
    return messagePage('Something went wrong', 'Please try again or contact your broker.', 500);
  }
}

// ---------------------------------------------------------------------------
// POST — performs the accept/decline. Triggered by the confirmation button.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'offer'))) {
      return messagePage('Too many requests', 'Please wait a moment and try again.', 429);
    }

    let response: string | null = null;
    try {
      const form = await req.formData();
      response = (form.get('response') as string | null) ?? null;
    } catch {
      response = null;
    }

    const { offer, short } = await loadOffer(params.token);
    if (short) return short;
    const now = new Date();

    if (response === 'decline') {
      if (offer!.status !== 'offered') {
        return messagePage('Already responded', 'This lead has already been resolved. No further action is needed.', 200);
      }
      await db
        .update(leadOffers)
        .set({ status: 'declined', declinedAt: now, respondedAt: now, updatedAt: now })
        .where(eq(leadOffers.id, offer!.id));
      try {
        await applyScore({ agentId: offer!.agentId, reason: 'system_decline', leadId: offer!.leadId, leadOfferId: offer!.id });
      } catch (err) {
        console.error('[api/offer] decline applyScore failed:', err);
      }
      await logLeadEvent(offer!.leadId, 'offer_declined', null);
      try {
        await reassignLead(offer!.leadId);
      } catch (err) {
        console.error('[api/offer] reassignLead failed:', err);
      }
      return messagePage('Thanks', 'You declined this lead. It has been reassigned to another agent.', 200);
    }

    if (response === 'accept') {
      if (offer!.status !== 'offered') {
        return messagePage(
          'Already responded',
          'This lead offer has already been responded to. If you accepted it, open the agent portal to manage it.',
          200,
          `${siteUrl()}/agent/login`,
        );
      }
      await db
        .update(leadOffers)
        .set({ status: 'accepted', acceptedAt: now, respondedAt: now, tokenUsedAt: now, updatedAt: now })
        .where(eq(leadOffers.id, offer!.id));
      await db
        .update(leads)
        .set({ acceptedAt: now, lastStatusChangedAt: now, updatedAt: now })
        .where(eq(leads.id, offer!.leadId));

      // Response-time score, 4 bands (spec v2 §2). A null offerSentAt (queued
      // offer dispatched asynchronously) is treated as the top tier.
      {
        let reason: ScoreReason = 'system_response_fast';
        let explicitDelta: number | undefined;
        if (offer!.offerSentAt) {
          const elapsed = now.getTime() - offer!.offerSentAt.getTime();
          if (elapsed < FIFTEEN_MIN_MS) reason = 'system_response_fast';
          else if (elapsed <= THIRTY_MIN_MS) {
            reason = 'system_response_fast';
            explicitDelta = 6;
          } else if (elapsed <= ONE_HOUR_MS) reason = 'system_response_good';
          else reason = 'system_response_slow';
        }
        try {
          await applyScore({ agentId: offer!.agentId, reason, delta: explicitDelta, leadId: offer!.leadId, leadOfferId: offer!.id });
        } catch (err) {
          console.error('[api/offer] accept applyScore failed:', err);
        }
      }

      await logLeadEvent(offer!.leadId, 'offer_accepted', null);

      try {
        const detailRows = await db
          .select({ lead: leads, agent: agents })
          .from(leads)
          .innerJoin(agents, eq(agents.id, offer!.agentId))
          .where(eq(leads.id, offer!.leadId))
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
        await setAgentSessionCookie(offer!.agentId);
      } catch (err) {
        console.error('[api/offer] setAgentSessionCookie failed:', err);
      }

      return NextResponse.redirect(new URL('/agent/leads', req.url), { status: 303 });
    }

    return messagePage('Invalid request', 'Please use the Accept or Decline button from your lead offer email.', 400);
  } catch (err) {
    console.error('[api/offer POST] error:', err);
    return messagePage('Something went wrong', 'We could not process your response. Please try again.', 500);
  }
}
