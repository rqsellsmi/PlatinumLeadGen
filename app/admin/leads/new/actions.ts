'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, locations } from '@/drizzle/schema';
import { autoOfferLead } from '@/lib/autoOffer';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { isLeadIntent, type LeadIntent } from '@/lib/leadIntent';

function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

/**
 * Manual lead entry (Section 21.6) — log offline/LSA phone leads into the
 * system so they route and track like web leads.
 */
export async function createManualLead(formData: FormData): Promise<void> {
  await requireAdmin();

  const slug = str(formData.get('locationSlug'));
  let locationId: number | null = null;
  if (slug) {
    const rows = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1);
    locationId = rows[0]?.id ?? null;
  }

  const intentRaw = String(formData.get('intent') ?? '');
  const intent: LeadIntent = isLeadIntent(intentRaw) ? intentRaw : 'seller';

  const now = new Date();
  const inserted = await db
    .insert(leads)
    .values({
      leadType: 'valuation',
      intent,
      status: 'new',
      source: 'manual',
      pageVariant: 'seo',
      firstName: str(formData.get('firstName')),
      lastName: str(formData.get('lastName')),
      email: str(formData.get('email')),
      phone: str(formData.get('phone')),
      propertyAddress: str(formData.get('propertyAddress')),
      propertyCity: str(formData.get('propertyCity')),
      // Captured so the out-of-state coverage gate (D22) has a real value for
      // manual/LSA leads — these never pass through Places, so without this the
      // gate can only string-parse the free-text address.
      propertyState: str(formData.get('propertyState')),
      timeframe: str(formData.get('timeframe')),
      locationId,
      updatedAt: now,
    })
    .returning({ id: leads.id });

  const leadId = inserted[0].id;
  try {
    await autoOfferLead(leadId);
  } catch (err) {
    console.error('[admin/leads/new] autoOfferLead failed:', err);
  }

  redirect(`/admin/leads/${leadId}`);
}
