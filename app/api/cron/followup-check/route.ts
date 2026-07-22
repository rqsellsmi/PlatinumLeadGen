/**
 * Cron: 48h escalation + weekly reminders for accepted leads. (Section 8)
 * Runs every 30 minutes.
 */
import { siteUrl } from '@/lib/siteUrl';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, isNull, isNotNull, lt, or, count } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, agents } from '@/drizzle/schema';
import {
  sendEmail,
  escalationEmail,
  weeklyReminderEmail,
  staleLeadWarningEmail,
} from '@/lib/email';
import { sendAgentSms } from '@/lib/agentSms';
import { updateReminderText } from '@/lib/smsTemplates';
import { applyScore } from '@/lib/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
        await sendAgentSms({
          agent: row.agent,
          kind: 'update_reminder',
          leadId: row.lead.id,
          body: updateReminderText({
            leadId: row.lead.id,
            firstName: row.lead.firstName ?? null,
            lastName: row.lead.lastName ?? null,
            address: row.lead.propertyAddress ?? null,
            leadUrl: `${siteUrl()}/agent/leads/${row.offer.id}`,
          }),
        });
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

    // Shared portal URL for update-clock notifications.
    const portalUrl = `${siteUrl()}/agent/leads`;

    const leadName = (l: { firstName: string | null; lastName: string | null }) =>
      `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim() || 'your lead';

    // ---- Unified update clock (v4 §5) — replaces stale_48h / stale_7day /
    //      stalled_30day with one recurring check, cadence by stage. ----

    // (c) Pre-deadline warning email — accepted + active, within 24h of the
    //     update deadline, not yet warned this cycle. staleWarningSentAt is the
    //     per-cycle dedup: a fresh status change (lastStatusChangedAt) re-arms it.
    const warnHorizon = new Date(now.getTime() + 24 * HOUR_MS);
    let updateWarned = 0;
    const warnRows = await db
      .select({ offer: leadOffers, lead: leads, agent: agents })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          isNotNull(leads.updateDeadline),
          gte(leads.updateDeadline, now), // not yet overdue
          lt(leads.updateDeadline, warnHorizon), // within 24h
          or(
            isNull(leads.staleWarningSentAt),
            isNull(leads.lastStatusChangedAt),
            lt(leads.staleWarningSentAt, leads.lastStatusChangedAt),
          ),
        ),
      );
    for (const row of warnRows) {
      try {
        await sendEmail(
          staleLeadWarningEmail({
            to: row.agent.email,
            agentName: `${row.agent.firstName} ${row.agent.lastName}`.trim(),
            leadName: leadName(row.lead),
            address: row.lead.propertyAddress,
            penaltyInHours: 24,
            portalUrl,
            relatedLeadId: row.lead.id,
            relatedAgentId: row.agent.id,
          }),
        );
        await db.update(leads).set({ staleWarningSentAt: now, updatedAt: now }).where(eq(leads.id, row.lead.id));
        updateWarned += 1;
      } catch (err) {
        console.error(`[cron/followup-check] update warning lead ${row.lead.id} failed:`, err);
      }
    }

    // (d) Missed-update penalty — past the deadline: flat −2, then the deadline
    //     recurs (+14d Signed / +7d otherwise) so it fires once per cycle, not
    //     every cron tick. update_deadline is null for Closed/Lost, so they are
    //     excluded automatically (the clock stops).
    let missedUpdatePenalized = 0;
    const overdueRows = await db
      .select({ offer: leadOffers, lead: leads })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .where(
        and(
          eq(leadOffers.status, 'accepted'),
          isNotNull(leads.updateDeadline),
          lt(leads.updateDeadline, now),
        ),
      );
    for (const row of overdueRows) {
      try {
        await applyScore({
          agentId: row.offer.agentId,
          reason: 'missed_update_checkin',
          leadId: row.lead.id,
          leadOfferId: row.offer.id,
        });
        const nextMs = row.lead.status === 'signed' ? 14 * 24 * HOUR_MS : 7 * 24 * HOUR_MS;
        await db
          .update(leads)
          .set({ updateDeadline: new Date(now.getTime() + nextMs), updatedAt: now })
          .where(eq(leads.id, row.lead.id));
        missedUpdatePenalized += 1;
      } catch (err) {
        console.error(`[cron/followup-check] missed-update penalty lead ${row.lead.id} failed:`, err);
      }
    }

    return NextResponse.json({
      escalated,
      reminded,
      updateWarned,
      missedUpdatePenalized,
    });
  } catch (err) {
    console.error('[cron/followup-check] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
