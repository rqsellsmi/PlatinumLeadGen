/**
 * Cron: 48h escalation + weekly reminders for accepted leads. (Section 8)
 * Runs every 30 minutes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, isNotNull, lt, or, count } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, agents } from '@/drizzle/schema';
import {
  sendEmail,
  escalationEmail,
  weeklyReminderEmail,
  staleLeadWarningEmail,
  stale6DayWarningEmail,
} from '@/lib/email';
import { applyScore } from '@/lib/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
}

export async function GET(req: NextRequest) {
  try {
    if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // (a) 48h escalation — accepted, first update overdue & never submitted, not yet escalated.
    const escalations = await db
      .select({ offer: leadOffers, lead: leads, agent: agents })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          lt(leadOffers.firstUpdateDue, now),
          isNull(leadOffers.firstUpdateSubmittedAt),
          isNull(leadOffers.escalationSentAt),
        ),
      );

    let escalated = 0;
    for (const row of escalations) {
      try {
        const acceptedAt = row.lead.acceptedAt ?? row.offer.acceptedAt;
        const hoursSinceAccept = acceptedAt
          ? Math.floor((now.getTime() - acceptedAt.getTime()) / HOUR_MS)
          : 48;
        const leadName = `${row.lead.firstName ?? ''} ${row.lead.lastName ?? ''}`.trim() || 'New lead';
        await sendEmail(
          escalationEmail({
            agentName: `${row.agent.firstName} ${row.agent.lastName}`.trim(),
            leadName,
            propertyAddress: row.lead.propertyAddress,
            hoursSinceAccept,
            adminLeadUrl: `${siteUrl()}/admin/leads/${row.lead.id}`,
          }),
        );
        await db
          .update(leadOffers)
          .set({ escalationSentAt: now, updatedAt: now })
          .where(eq(leadOffers.id, row.offer.id));
        escalated += 1;
      } catch (err) {
        console.error(`[cron/followup-check] escalation offer ${row.offer.id} failed:`, err);
      }
    }

    // (b) Weekly reminder — accepted offers whose nextReminderDue has passed.
    const reminders = await db
      .select({ offer: leadOffers, agent: agents })
      .from(leadOffers)
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(and(eq(leadOffers.status, 'accepted'), lt(leadOffers.nextReminderDue, now)));

    let reminded = 0;
    for (const row of reminders) {
      try {
        const openCountRows = await db
          .select({ n: count() })
          .from(leadOffers)
          .where(and(eq(leadOffers.agentId, row.agent.id), eq(leadOffers.status, 'accepted')));
        const openLeadCount = openCountRows[0]?.n ?? 0;

        await sendEmail(
          weeklyReminderEmail({
            to: row.agent.email,
            agentName: `${row.agent.firstName} ${row.agent.lastName}`.trim(),
            openLeadCount,
            portalUrl: `${siteUrl()}/agent/leads`,
          }),
        );

        const base = row.offer.nextReminderDue ?? now;
        await db
          .update(leadOffers)
          .set({ nextReminderDue: new Date(base.getTime() + WEEK_MS), updatedAt: now })
          .where(eq(leadOffers.id, row.offer.id));
        reminded += 1;
      } catch (err) {
        console.error(`[cron/followup-check] reminder offer ${row.offer.id} failed:`, err);
      }
    }

    // Shared portal URL for stale notifications.
    const portalUrl = `${siteUrl()}/agent/leads`;
    const t36 = new Date(now.getTime() - 36 * HOUR_MS);
    const t48 = new Date(now.getTime() - 48 * HOUR_MS);
    const t6d = new Date(now.getTime() - 6 * 24 * HOUR_MS);
    const t7d = new Date(now.getTime() - 7 * 24 * HOUR_MS);

    const leadName = (l: { firstName: string | null; lastName: string | null }) =>
      `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim() || 'your lead';

    // (c) 36-hour warning (§E.5 Check 1) — first update overdue, not yet warned.
    let stale36Warned = 0;
    const warn36 = await db
      .select({ offer: leadOffers, lead: leads, agent: agents })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          isNull(leadOffers.firstUpdateSubmittedAt),
          isNotNull(leadOffers.offerSentAt),
          lt(leadOffers.offerSentAt, t36),
          isNull(leads.staleWarningSentAt),
        ),
      );
    for (const row of warn36) {
      try {
        await sendEmail(
          staleLeadWarningEmail({
            to: row.agent.email,
            agentName: `${row.agent.firstName} ${row.agent.lastName}`.trim(),
            leadName: leadName(row.lead),
            address: row.lead.propertyAddress,
            penaltyInHours: 12,
            portalUrl,
            relatedLeadId: row.lead.id,
            relatedAgentId: row.agent.id,
          }),
        );
        await db.update(leads).set({ staleWarningSentAt: now, updatedAt: now }).where(eq(leads.id, row.lead.id));
        stale36Warned += 1;
      } catch (err) {
        console.error(`[cron/followup-check] 36h warning lead ${row.lead.id} failed:`, err);
      }
    }

    // (d) 48-hour penalty (§E.5 Check 2) — first update overdue, no penalty yet.
    let stale48Penalized = 0;
    const pen48 = await db
      .select({ offer: leadOffers, lead: leads })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          isNull(leadOffers.firstUpdateSubmittedAt),
          isNotNull(leadOffers.offerSentAt),
          lt(leadOffers.offerSentAt, t48),
          isNull(leads.lastPenaltyAt),
        ),
      );
    for (const row of pen48) {
      try {
        await applyScore({
          agentId: row.offer.agentId,
          reason: 'stale_48h',
          leadId: row.lead.id,
          leadOfferId: row.offer.id,
        });
        await db.update(leads).set({ lastPenaltyAt: now, updatedAt: now }).where(eq(leads.id, row.lead.id));
        stale48Penalized += 1;
      } catch (err) {
        console.error(`[cron/followup-check] 48h penalty lead ${row.lead.id} failed:`, err);
      }
    }

    // (e) 6-day warning (§E.5 Check 3 / §K.4) — reuses staleWarningSentAt:
    //     lastPenaltyAt set & older than 6 days, and the last warning predates the
    //     last penalty (i.e. a fresh cycle that hasn't been warned yet).
    let stale6dWarned = 0;
    const warn6d = await db
      .select({ offer: leadOffers, lead: leads, agent: agents })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          isNotNull(leads.lastPenaltyAt),
          lt(leads.lastPenaltyAt, t6d),
          or(isNull(leads.staleWarningSentAt), lt(leads.staleWarningSentAt, leads.lastPenaltyAt)),
        ),
      );
    for (const row of warn6d) {
      try {
        await sendEmail(
          stale6DayWarningEmail({
            to: row.agent.email,
            agentName: `${row.agent.firstName} ${row.agent.lastName}`.trim(),
            leadName: leadName(row.lead),
            address: row.lead.propertyAddress,
            portalUrl,
            relatedLeadId: row.lead.id,
            relatedAgentId: row.agent.id,
          }),
        );
        await db.update(leads).set({ staleWarningSentAt: now, updatedAt: now }).where(eq(leads.id, row.lead.id));
        stale6dWarned += 1;
      } catch (err) {
        console.error(`[cron/followup-check] 6-day warning lead ${row.lead.id} failed:`, err);
      }
    }

    // (f) 7-day recurring penalty (§E.5 Check 4) — lastPenaltyAt older than 7 days.
    let stale7dPenalized = 0;
    const pen7d = await db
      .select({ offer: leadOffers, lead: leads })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          isNotNull(leads.lastPenaltyAt),
          lt(leads.lastPenaltyAt, t7d),
        ),
      );
    for (const row of pen7d) {
      try {
        await applyScore({
          agentId: row.offer.agentId,
          reason: 'stale_7day',
          leadId: row.lead.id,
          leadOfferId: row.offer.id,
        });
        // Reset the cycle: new penalty time; the next 6-day warning fires again
        // because staleWarningSentAt now predates lastPenaltyAt (§K.4).
        await db.update(leads).set({ lastPenaltyAt: now, updatedAt: now }).where(eq(leads.id, row.lead.id));
        stale7dPenalized += 1;
      } catch (err) {
        console.error(`[cron/followup-check] 7-day penalty lead ${row.lead.id} failed:`, err);
      }
    }

    return NextResponse.json({
      escalated,
      reminded,
      stale36Warned,
      stale48Penalized,
      stale6dWarned,
      stale7dPenalized,
    });
  } catch (err) {
    console.error('[cron/followup-check] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
