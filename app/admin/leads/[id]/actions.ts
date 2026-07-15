'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agentScoreLog, agents } from '@/drizzle/schema';
import { reassignLead } from '@/lib/autoOffer';
import { applyScore } from '@/lib/scoring';
import { sendEmail, leadDeletedNotificationEmail } from '@/lib/email';
import { requireAdmin } from '@/components/admin/requireAdmin';

const STATUSES = [
  'new',
  'attempted_contact',
  'contacted',
  'qualified',
  'working',
  'closed',
  'lost',
] as const;
type LeadStatus = (typeof STATUSES)[number];

export async function updateLeadStatus(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('leadId'));
  const status = String(formData.get('status') ?? '');
  if (!id || !(STATUSES as readonly string[]).includes(status)) {
    throw new Error('Invalid status update');
  }
  const now = new Date();
  await db
    .update(leads)
    .set({ status: status as LeadStatus, lastStatusChangedAt: now, updatedAt: now })
    .where(eq(leads.id, id));
  revalidatePath(`/admin/leads/${id}`);
  revalidatePath('/admin/leads');
}

export async function softDeleteLead(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('leadId'));
  if (!id) throw new Error('Invalid lead');
  const now = new Date();

  // 1. Mark the lead deleted.
  const leadRows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  const lead = leadRows[0];
  await db.update(leads).set({ isDeleted: true, updatedAt: now }).where(eq(leads.id, id));

  // 2. Cancel any OPEN (offered) offers for this lead (§K.3 — only these).
  const openOffers = await db
    .select({ id: leadOffers.id, agentId: leadOffers.agentId })
    .from(leadOffers)
    .where(and(eq(leadOffers.leadId, id), eq(leadOffers.status, 'offered')));
  const openIds = openOffers.map((o) => o.id);
  if (openIds.length > 0) {
    await db
      .update(leadOffers)
      .set({ status: 'closed_manual', respondedAt: now, updatedAt: now })
      .where(inArray(leadOffers.id, openIds));
  }

  // 3. Reverse ONLY negative, not-yet-negated score entries tied to those
  //    cancelled offers (§K.3 — a 3-day-old decline penalty stays).
  const affectedAgentIds = new Set<number>(openOffers.map((o) => o.agentId));
  if (openIds.length > 0) {
    const entries = await db
      .select()
      .from(agentScoreLog)
      .where(
        and(
          inArray(agentScoreLog.leadOfferId, openIds),
          lt(agentScoreLog.delta, 0),
          or(eq(agentScoreLog.isNegated, false), isNull(agentScoreLog.isNegated)),
        ),
      );
    for (const e of entries) {
      await db
        .update(agentScoreLog)
        .set({ isNegated: true, negatedReason: 'Lead deleted by admin' })
        .where(eq(agentScoreLog.id, e.id));
      try {
        await applyScore({
          agentId: e.agentId,
          reason: 'lead_deleted_reversal',
          delta: -e.delta,
          note: 'Score reversed because lead was deleted',
          leadId: id,
          leadOfferId: e.leadOfferId ?? undefined,
        });
      } catch (err) {
        console.error('[softDeleteLead] reversal failed:', err);
      }
      affectedAgentIds.add(e.agentId);
    }
  }

  // 4. Notify affected agents (§E.7).
  if (affectedAgentIds.size > 0) {
    const leadName = `${lead?.firstName ?? ''} ${lead?.lastName ?? ''}`.trim() || 'A lead';
    const agentRows = await db
      .select({ id: agents.id, email: agents.email, first: agents.firstName, last: agents.lastName })
      .from(agents)
      .where(inArray(agents.id, Array.from(affectedAgentIds)));
    for (const a of agentRows) {
      try {
        await sendEmail(
          leadDeletedNotificationEmail({
            to: a.email,
            agentName: `${a.first} ${a.last}`.trim(),
            leadName,
            note: 'Any score penalties related to this lead have been reversed.',
            relatedLeadId: id,
            relatedAgentId: a.id,
          }),
        );
      } catch (err) {
        console.error('[softDeleteLead] notify failed:', err);
      }
    }
  }

  revalidatePath('/admin/leads');
  redirect('/admin/leads');
}

export async function reassignLeadAction(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('leadId'));
  if (!id) throw new Error('Invalid lead');
  await reassignLead(id);
  revalidatePath(`/admin/leads/${id}`);
}
