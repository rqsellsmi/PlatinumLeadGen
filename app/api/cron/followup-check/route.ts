/**
 * Cron: 48h escalation + weekly reminders for accepted leads. (Section 8)
 * Runs every 30 minutes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, lt, count } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, agents } from '@/drizzle/schema';
import { sendEmail, escalationEmail, weeklyReminderEmail } from '@/lib/email';

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

    return NextResponse.json({ escalated, reminded });
  } catch (err) {
    console.error('[cron/followup-check] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
