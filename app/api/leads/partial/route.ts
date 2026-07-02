/**
 * POST /api/leads/partial — capture a partial (valuation) lead by sessionId.
 * Upserts by sessionId; triggers NO emails. (Section 4.7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
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
    const normalizedAddress = normalizeAddress(input.propertyAddress).full || null;

    const propertyFields = {
      sessionId: input.sessionId,
      propertyAddress: input.propertyAddress,
      propertyCity: input.propertyCity ?? null,
      propertyState: input.propertyState ?? null,
      propertyZip: input.propertyZip ?? null,
      propertyLat: input.propertyLat ?? null,
      propertyLng: input.propertyLng ?? null,
      normalizedAddress,
      locationId,
      pageVariant: input.pageVariant ?? 'seo',
      ...attributionColumns(input),
      updatedAt: now,
    };

    // Reuse this session's partial first; otherwise adopt an existing UNNAMED
    // partial at the same address (a prior abandoned valuation) so repeated
    // address entries don't pile up as separate "Unnamed lead" rows (§D).
    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.sessionId, input.sessionId), eq(leads.isDeleted, false)))
      .limit(1);

    let targetId = existing[0]?.id ?? null;
    if (targetId == null && normalizedAddress) {
      const addrPartial = await db
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.normalizedAddress, normalizedAddress),
            eq(leads.isDeleted, false),
            isNull(leads.email), // only adopt a contact-less partial, never a real lead
          ),
        )
        .limit(1);
      targetId = addrPartial[0]?.id ?? null;
    }

    if (targetId != null) {
      await db.update(leads).set(propertyFields).where(eq(leads.id, targetId));
      return NextResponse.json({ leadId: targetId });
    }

    const inserted = await db
      .insert(leads)
      .values({
        leadType: 'valuation',
        status: 'new',
        ...propertyFields, // includes sessionId
      })
      .returning({ id: leads.id });

    await logLeadEvent(inserted[0].id, 'address_entered', input.propertyAddress);

    return NextResponse.json({ leadId: inserted[0].id });
  } catch (err) {
    console.error('[api/leads/partial] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
