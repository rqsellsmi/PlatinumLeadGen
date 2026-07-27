/**
 * Buyer inquiry intake (schedule a showing / contact an agent on a listing).
 *
 * A new buyer becomes a lead with intent='buyer', tied to the listing, and is
 * routed through the EXISTING pipeline (autoOfferLead → proximity to the
 * listing → nearest agent; out-of-area → admin). A buyer who already has an
 * active buyer lead (same email) has the new listing interest attached to it
 * instead of creating a second lead + offer (O3).
 */
import { and, eq, desc, notInArray, sql } from 'drizzle-orm';
import { db } from './db';
import { leads, appointmentRequests, type Lead } from '../drizzle/schema';
import { getListingByKey } from './idx';
import { autoOfferLead } from './autoOffer';
import { logLeadEvent } from './leadEvents';
import { sendEmail, buyerInquiryNotificationEmail } from './email';
import { siteUrl } from './siteUrl';
import type { BuyerInquiryInput } from './validation';

export interface BuyerInquiryResult {
  ok: boolean;
  reason?: 'listing-not-found';
  leadId?: number;
  created?: boolean;
  offered?: boolean;
}

/** Statuses that mean a buyer lead is finished (a new inquiry starts fresh). */
const CLOSED_STATUSES = ['closed', 'lost'] as const;

/**
 * Pure decision: attach to an existing active buyer lead, or create a new one.
 * Separated from the DB so it can be unit-tested.
 */
export function decideBuyerInquiry(existing: { status: string } | null | undefined): 'attach' | 'create' {
  if (!existing) return 'create';
  return (CLOSED_STATUSES as readonly string[]).includes(existing.status) ? 'create' : 'attach';
}

/** The most recent active (non-closed/lost) buyer lead for this email, if any. */
export async function findActiveBuyerLead(email: string): Promise<Lead | null> {
  const rows = await db
    .select()
    .from(leads)
    .where(
      and(
        sql`lower(${leads.email}) = ${email.toLowerCase()}`,
        eq(leads.intent, 'buyer'),
        eq(leads.isDeleted, false),
        notInArray(leads.status, [...CLOSED_STATUSES]),
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

function preferredLabel(input: BuyerInquiryInput): string | null {
  return [input.preferredDate, input.preferredTime].filter(Boolean).join(' · ') || null;
}

export async function createBuyerInquiry(
  input: BuyerInquiryInput,
  buyerUserId?: number | null,
): Promise<BuyerInquiryResult> {
  const listing = await getListingByKey(input.listingKey);
  if (!listing) return { ok: false, reason: 'listing-not-found' };

  const listingUrl = `${siteUrl()}/listing/${encodeURIComponent(input.listingKey)}`;
  const listingAddress = [listing.address, listing.city].filter(Boolean).join(', ') || listing.city || null;
  const name = `${input.firstName} ${input.lastName ?? ''}`.trim();
  const preferred = preferredLabel(input);
  const eventNote =
    `${input.kind === 'showing' ? 'Showing requested' : 'Contact requested'} for ` +
    `${listingAddress ?? input.listingKey}` +
    `${preferred ? ` (${preferred})` : ''}${input.message ? ` — ${input.message}` : ''}`;

  const existing = await findActiveBuyerLead(input.email);
  const decision = decideBuyerInquiry(existing);

  let leadId: number;
  let created: boolean;
  let offered = false;

  if (decision === 'attach' && existing) {
    leadId = existing.id;
    created = false;
    await db
      .update(leads)
      .set({
        interestedListingKey: input.listingKey,
        phone: input.phone ?? existing.phone,
        // Link the buyer account if this inquiry came from a signed-in buyer and
        // the lead wasn't already linked.
        ...(buyerUserId && existing.buyerUserId == null ? { buyerUserId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
    await logLeadEvent(leadId, 'buyer_inquiry', eventNote);
  } else {
    created = true;
    const inserted = await db
      .insert(leads)
      .values({
        leadType: 'buyer_inquiry',
        intent: 'buyer',
        status: 'new',
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email,
        phone: input.phone ?? null,
        propertyAddress: listing.address ?? null,
        propertyCity: listing.city ?? null,
        propertyState: listing.stateOrProvince ?? null,
        propertyLat: listing.latitude ?? null,
        propertyLng: listing.longitude ?? null,
        interestedListingKey: input.listingKey,
        buyerUserId: buyerUserId ?? null,
        source: 'buyer_search',
      })
      .returning({ id: leads.id });
    leadId = inserted[0].id;
    await logLeadEvent(leadId, 'buyer_inquiry', eventNote);

    // Route it through the existing pipeline (proximity to the listing coords).
    try {
      const res = await autoOfferLead(leadId);
      offered = !!res.sent;
    } catch (err) {
      console.error('[buyerInquiry] autoOffer failed:', err);
    }
  }

  // Persist a showing request (date/time) linked to the lead + listing.
  if (input.kind === 'showing') {
    try {
      await db.insert(appointmentRequests).values({
        leadId,
        listingKey: input.listingKey,
        name,
        phone: input.phone ?? null,
        email: input.email,
        preferredTime: preferred,
        notes: input.message ?? null,
        source: 'showing',
      });
    } catch (err) {
      console.error('[buyerInquiry] appointment insert failed:', err);
    }
  }

  // Notify the brokerage (email is the source of truth; best-effort).
  try {
    await sendEmail(
      buyerInquiryNotificationEmail({
        kind: input.kind,
        name,
        phone: input.phone ?? null,
        email: input.email,
        preferred,
        message: input.message ?? null,
        listingAddress,
        listingUrl,
      }),
    );
  } catch (err) {
    console.error('[buyerInquiry] notification email failed:', err);
  }

  return { ok: true, leadId, created, offered };
}
