/**
 * Lead event timeline helpers (v1.6 §D.4). Best-effort: never throws.
 */
import { db } from './db';
import { leadEvents } from '../drizzle/schema';

export type LeadEventType =
  | 'address_entered'
  | 'valuation_submitted'
  | 'duplicate_submission'
  | 'appointment_requested'
  | 'offer_sent'
  | 'offer_accepted'
  | 'offer_declined'
  | 'offer_expired'
  | 'manually_assigned'
  | 'status_updated'
  | 'contact_updated'
  | 'marked_lost'
  | 'pipeline_stalled'
  | 'reopened';

export async function logLeadEvent(
  leadId: number,
  eventType: LeadEventType,
  note?: string | null,
): Promise<number | null> {
  try {
    const rows = await db
      .insert(leadEvents)
      .values({ leadId, eventType, note: note ?? null })
      .returning({ id: leadEvents.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[leadEvents] failed to log ${eventType} for lead ${leadId}:`, err);
    return null;
  }
}
