/**
 * POST /api/leads/partial — capture a partial (valuation) lead by sessionId.
 * Upserts by sessionId; triggers NO emails. (Section 4.7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, locations } from '@/drizzle/schema';
import { partialLeadSchema } from '@/lib/validation';
import { attributionColumns } from '@/lib/attributionServer';
import { normalizeAddress } from '@/lib/addressNormalization';
import { logLeadEvent } from '@/lib/leadEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveLocationId(slug: string | null | undefined): Promise<number | null> {
  if (!slug) return null;
  const rows = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1);
  return rows[0]?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = partialLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const locationId = await resolveLocationId(input.locationSlug);
    const now = new Date();

    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.sessionId, input.sessionId), eq(leads.isDeleted, false)))
      .limit(1);

    const propertyFields = {
      propertyAddress: input.propertyAddress,
      propertyCity: input.propertyCity ?? null,
      propertyState: input.propertyState ?? null,
      propertyZip: input.propertyZip ?? null,
      propertyLat: input.propertyLat ?? null,
      propertyLng: input.propertyLng ?? null,
      normalizedAddress: normalizeAddress(input.propertyAddress).full || null,
      locationId,
      pageVariant: input.pageVariant ?? 'seo',
      ...attributionColumns(input),
      updatedAt: now,
    };

    if (existing[0]) {
      const leadId = existing[0].id;
      await db.update(leads).set(propertyFields).where(eq(leads.id, leadId));
      return NextResponse.json({ leadId });
    }

    const inserted = await db
      .insert(leads)
      .values({
        sessionId: input.sessionId,
        leadType: 'valuation',
        status: 'new',
        ...propertyFields,
      })
      .returning({ id: leads.id });

    await logLeadEvent(inserted[0].id, 'address_entered', input.propertyAddress);

    return NextResponse.json({ leadId: inserted[0].id });
  } catch (err) {
    console.error('[api/leads/partial] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
