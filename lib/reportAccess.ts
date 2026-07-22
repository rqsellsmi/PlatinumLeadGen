/**
 * Market-report access + durable link tokens (IDX spec §5.3 / §8.3).
 *
 * The homeowner's report lives on the Full Valuation page. A per-lead
 * `reportToken` (opaque, stored on the lead) makes the link durable — clicked
 * from the confirmation email it reveals the report without re-entering contact
 * info. Views are counted for the admin access log.
 */
import { siteUrl } from './siteUrl';
import { randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { leads } from '../drizzle/schema';
import { getRevealedValuationByLeadId, type RevealedValuation } from './valuationStore';

/** Ensure the lead has a report token, generating+persisting one if absent. */
export async function ensureReportToken(leadId: number): Promise<string | null> {
  try {
    const rows = await db
      .select({ token: leads.reportToken })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    const existing = rows[0]?.token;
    if (existing) return existing;
    const token = randomBytes(16).toString('hex'); // 32 hex chars
    await db.update(leads).set({ reportToken: token }).where(eq(leads.id, leadId));
    return token;
  } catch (err) {
    console.error('[reportAccess] ensureReportToken failed:', err);
    return null;
  }
}

/** Build the absolute report URL for the confirmation email. */
export function reportUrl(citySlug: string | null | undefined, token: string): string {
  const base = siteUrl();
  const city = citySlug ? `&city=${encodeURIComponent(citySlug)}` : '';
  return `${base}/thank-you?type=valuation${city}&report=${token}`;
}

/** Everything the Full Valuation page needs about the subject property. */
export interface ReportContext {
  leadId: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  estimatedValue: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  revealed: RevealedValuation | null; // confidence / basics / sale history, if a valuation is linked
}

/** Resolve a report token → the subject-property context (or null if invalid). */
export async function getReportContext(token: string): Promise<ReportContext | null> {
  if (!token) return null;
  try {
    const rows = await db
      .select()
      .from(leads)
      .where(eq(leads.reportToken, token))
      .limit(1);
    const lead = rows[0];
    if (!lead || lead.isDeleted) return null;
    const revealed = await getRevealedValuationByLeadId(lead.id);
    return {
      leadId: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      phone: lead.phone,
      email: lead.email,
      address: lead.propertyAddress ?? revealed?.address ?? null,
      city: lead.propertyCity,
      latitude: lead.propertyLat ?? revealed?.latitude ?? null,
      longitude: lead.propertyLng ?? revealed?.longitude ?? null,
      estimatedValue: lead.estimatedValue ?? revealed?.estimatedValue ?? null,
      priceRangeLow: lead.priceRangeLow ?? revealed?.priceRangeLow ?? null,
      priceRangeHigh: lead.priceRangeHigh ?? revealed?.priceRangeHigh ?? null,
      revealed,
    };
  } catch (err) {
    console.error('[reportAccess] getReportContext failed:', err);
    return null;
  }
}

/** Record a report view for the admin access log (first-access + count). */
export async function logReportView(leadId: number): Promise<void> {
  try {
    await db
      .update(leads)
      .set({
        reportViewCount: sql`${leads.reportViewCount} + 1`,
        reportFirstAccessedAt: sql`COALESCE(${leads.reportFirstAccessedAt}, now())`,
      })
      .where(eq(leads.id, leadId));
  } catch (err) {
    console.error('[reportAccess] logReportView failed:', err);
  }
}
