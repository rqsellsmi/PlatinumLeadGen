/**
 * Agent-scoped lead contact edits. An agent may correct the name and contact
 * details (first/last name, email, phone) on a lead they actively own — i.e.
 * they hold an accepted offer for it. Ownership is re-verified server-side on
 * every call; the property record and routing are untouched.
 */
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { leadOffers, leads } from '../drizzle/schema';
import { logLeadEvent } from './leadEvents';
import { agentLeadContactSchema, type AgentLeadContactInput } from './validation';

export type UpdateContactResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'not-owned'; message?: string };

/** Update the contact fields on a lead the agent owns via an accepted offer. */
export async function updateLeadContactInfo(
  agentId: number,
  input: unknown,
): Promise<UpdateContactResult> {
  const parsed = agentLeadContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.issues[0]?.message };
  }
  const data: AgentLeadContactInput = parsed.data;

  // The offer must exist, belong to this agent, and be accepted (they own it).
  const offerRows = await db
    .select({ leadId: leadOffers.leadId, status: leadOffers.status })
    .from(leadOffers)
    .where(and(eq(leadOffers.id, data.leadOfferId), eq(leadOffers.agentId, agentId)))
    .limit(1);
  const offer = offerRows[0];
  if (!offer || offer.status !== 'accepted') {
    return { ok: false, reason: 'not-owned' };
  }

  const firstName = data.firstName.trim();
  const lastName = data.lastName?.trim() ? data.lastName.trim() : null;
  const email = data.email.trim();
  const phone = data.phone?.trim() ? data.phone.trim() : null;

  await db
    .update(leads)
    .set({ firstName, lastName, email, phone, updatedAt: new Date() })
    .where(eq(leads.id, offer.leadId));

  await logLeadEvent(
    offer.leadId,
    'contact_updated',
    `Contact details updated by agent — ${[firstName, lastName].filter(Boolean).join(' ')}`,
  );

  return { ok: true };
}
