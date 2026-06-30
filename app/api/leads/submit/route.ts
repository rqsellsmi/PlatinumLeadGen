/**
 * POST /api/leads/submit — complete a lead (upgrade the partial if present),
 * auto-offer it, and send the homeowner a confirmation email. (Section 4.7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, locations } from '@/drizzle/schema';
import { leadSubmitSchema } from '@/lib/validation';
import { autoOfferLead } from '@/lib/autoOffer';
import { getValuation } from '@/lib/rentcast';
import { sendEmail, homeownerConfirmationEmail } from '@/lib/email';
import { checkPreset, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveLocationId(slug: string | null | undefined): Promise<number | null> {
  if (!slug) return null;
  const rows = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1);
  return rows[0]?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await checkPreset(clientIp(req.headers), 'lead_submit'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = leadSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const locationId = await resolveLocationId(input.locationSlug);
    const now = new Date();

    let propertyLat = input.propertyLat ?? null;
    let propertyLng = input.propertyLng ?? null;
    let estimatedValue = input.estimatedValue ?? null;
    let priceRangeLow = input.priceRangeLow ?? null;
    let priceRangeHigh = input.priceRangeHigh ?? null;

    // If coordinates are missing but an address is present, geocode/value it.
    if ((propertyLat == null || propertyLng == null) && input.propertyAddress) {
      try {
        const v = await getValuation(input.propertyAddress);
        if (propertyLat == null) propertyLat = v.latitude;
        if (propertyLng == null) propertyLng = v.longitude;
        if (estimatedValue == null) estimatedValue = v.estimatedValue;
        if (priceRangeLow == null) priceRangeLow = v.priceRangeLow;
        if (priceRangeHigh == null) priceRangeHigh = v.priceRangeHigh;
      } catch (err) {
        console.error('[api/leads/submit] valuation lookup failed:', err);
      }
    }

    const fields = {
      leadType: input.leadType,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email,
      phone: input.phone ?? null,
      propertyAddress: input.propertyAddress ?? null,
      propertyCity: input.propertyCity ?? null,
      propertyState: input.propertyState ?? null,
      propertyZip: input.propertyZip ?? null,
      propertyLat,
      propertyLng,
      timeframe: input.timeframe ?? null,
      estimatedValue,
      priceRangeLow,
      priceRangeHigh,
      locationId,
      pageVariant: input.pageVariant ?? 'seo',
      updatedAt: now,
    };

    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.sessionId, input.sessionId), eq(leads.isDeleted, false)))
      .limit(1);

    let leadId: number;
    if (existing[0]) {
      leadId = existing[0].id;
      await db.update(leads).set(fields).where(eq(leads.id, leadId));
    } else {
      const inserted = await db
        .insert(leads)
        .values({ sessionId: input.sessionId, status: 'new', ...fields })
        .returning({ id: leads.id });
      leadId = inserted[0].id;
    }

    // Increment social proof count for this location (Section 3.5) — never decremented.
    if (locationId != null) {
      try {
        await db
          .update(locations)
          .set({ socialProofCount: sql`${locations.socialProofCount} + 1` })
          .where(eq(locations.id, locationId));
      } catch (err) {
        console.error('[api/leads/submit] socialProofCount increment failed:', err);
      }
    }

    // Routing + confirmation must not 500 the request — log and continue.
    try {
      await autoOfferLead(leadId);
    } catch (err) {
      console.error('[api/leads/submit] autoOfferLead failed:', err);
    }

    if (input.email) {
      try {
        await sendEmail(
          homeownerConfirmationEmail({
            to: input.email,
            firstName: input.firstName ?? null,
            city: input.propertyCity ?? null,
          }),
        );
      } catch (err) {
        console.error('[api/leads/submit] confirmation email failed:', err);
      }
    }

    return NextResponse.json({ success: true, leadId });
  } catch (err) {
    console.error('[api/leads/submit] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
