/**
 * POST /api/webhooks/lead — external lead intake (API key + rate limited). (Section 7)
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, locations } from '@/drizzle/schema';
import { webhookLeadSchema } from '@/lib/validation';
import { verifyApiKey } from '@/lib/apiKeys';
import { checkPreset, clientIp } from '@/lib/rateLimit';
import { autoOfferLead } from '@/lib/autoOffer';
import { attributionColumns } from '@/lib/attributionServer';
import { normalizedAddressKey } from '@/lib/leadDedup';
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
    const apiKeyId = await verifyApiKey(req.headers.get('x-api-key'));
    if (apiKeyId == null) {
      return NextResponse.json({ error: 'invalid_api_key' }, { status: 401 });
    }

    if (!(await checkPreset(clientIp(req.headers), 'webhook'))) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = webhookLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const locationId = await resolveLocationId(input.locationSlug);
    const now = new Date();

    const fields = {
      leadType: 'webhook' as const,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email,
      phone: input.phone ?? null,
      propertyAddress: input.propertyAddress ?? null,
      propertyCity: input.propertyCity ?? null,
      propertyState: input.propertyState ?? null,
      propertyZip: input.propertyZip ?? null,
      propertyLat: input.propertyLat ?? null,
      propertyLng: input.propertyLng ?? null,
      timeframe: input.timeframe ?? null,
      estimatedValue: input.estimatedValue ?? null,
      priceRangeLow: input.priceRangeLow ?? null,
      priceRangeHigh: input.priceRangeHigh ?? null,
      normalizedAddress: normalizedAddressKey(input.propertyAddress),
      locationId,
      source: input.source ?? 'webhook',
      ...attributionColumns(input),
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

    await logLeadEvent(leadId, 'valuation_submitted', input.source ?? 'webhook');

    try {
      await autoOfferLead(leadId);
    } catch (err) {
      console.error('[api/webhooks/lead] autoOfferLead failed:', err);
    }

    return NextResponse.json({ success: true, leadId });
  } catch (err) {
    console.error('[api/webhooks/lead] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
