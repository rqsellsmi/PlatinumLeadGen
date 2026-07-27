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
  | 'buyer_inquiry'
  | 'marked_lost'
  | 'pipeline_stalled'
  | 'reopened'
  // Buyer accounts (migration 0037/0038)
  | 'buyer_engaged' // a buyer account save/favorite/showing created or linked this lead
  | 'lead_linked' // an existing lead was linked to a buyer account
  | 'referral_pending' // buyer claimed one of our agents → held for admin review
  | 'referral_resolved'; // admin confirmed eligible/exempt

export async function logLeadEvent(
  leadId: number,
  eventType: LeadEventType,
  note?: string | null,
): Promise<void> {
  try {
    await db.insert(leadEvents).values({ leadId, eventType, note: note ?? null });
  } catch (err) {
    console.error(`[leadEvents] failed to log ${eventType} for lead ${leadId}:`, err);
  }
}
