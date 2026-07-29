/**
 * Market-report access — the lead-bound CAPABILITY (IDX spec §5.3 / §8.3,
 * review items #7 / #10 / #14, decision D3).
 *
 * The report token is the only thing that authorizes revealing a lead's record
 * to a browser. Possession of a live token IS the authorization; knowing the
 * property address or the lead's email/phone is NOT (see lib/leadIdentity.ts
 * for why). Three public surfaces ride this one capability:
 *
 *   - the /thank-you report reveal,
 *   - POST /api/appointments (D4 / #10 — replaced the raw `leadId`),
 *   - the optional seller qualifiers (D15).
 *
 * Tokens are opaque, expiring and revocable. The pure lifecycle rules live in
 * ./reportToken so they can be unit-tested without a database.
 */
import { siteUrl } from './siteUrl';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { leads } from '../drizzle/schema';
import {
  generateReportToken,
  isReportTokenUsable,
  reportTokenExpiry,
  REPORT_TOKEN_TTL_DAYS,
} from './reportToken';
import { getRevealedValuationByLeadId, type RevealedValuation } from './valuationStore';

export { REPORT_TOKEN_TTL_DAYS };

/**
 * Mint a fresh capability for a lead, replacing any previous one. Used when a
 * lead is created and when an existing token has lapsed and the homeowner asks
 * for a new link.
 */
export async function issueReportToken(leadId: number): Promise<string | null> {
  try {
    const now = new Date();
    const token = generateReportToken();
    await db
      .update(leads)
      .set({
        reportToken: token,
        reportTokenIssuedAt: now,
        reportTokenExpiresAt: reportTokenExpiry(now),
        reportTokenRevokedAt: null, // a new capability supersedes an old revocation
      })
      .where(eq(leads.id, leadId));
    return token;
  } catch (err) {
    console.error('[reportAccess] issueReportToken failed:', err);
    return null;
  }
}

/**
 * Return the lead's current token if it is still usable, otherwise mint a new
 * one. Callers get a token that is live by construction.
 */
export async function ensureReportToken(leadId: number): Promise<string | null> {
  try {
    const rows = await db
      .select({
        token: leads.reportToken,
        expiresAt: leads.reportTokenExpiresAt,
        revokedAt: leads.reportTokenRevokedAt,
      })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    const row = rows[0];
    if (row && isReportTokenUsable(row)) return row.token;
    return await issueReportToken(leadId);
  } catch (err) {
    console.error('[reportAccess] ensureReportToken failed:', err);
    return null;
  }
}

/**
 * Kill a lead's report link. Invoked when a link is known or suspected to have
 * leaked, and available to the admin lead page. Idempotent.
 */
export async function revokeReportToken(leadId: number): Promise<void> {
  try {
    await db
      .update(leads)
      .set({ reportTokenRevokedAt: new Date() })
      .where(eq(leads.id, leadId));
  } catch (err) {
    console.error('[reportAccess] revokeReportToken failed:', err);
  }
}

/** Build the absolute report URL for the confirmation / report-link email. */
export function reportUrl(citySlug: string | null | undefined, token: string): string {
  const base = siteUrl();
  const city = citySlug ? `&city=${encodeURIComponent(citySlug)}` : '';
  return `${base}/thank-you?type=valuation${city}&report=${token}`;
}

/**
 * Resolve a presented token to the lead it authorizes, or null.
 *
 * This is the single choke point every capability-bearing surface goes through
 * — the reveal, the appointment request and the qualifier writes. An expired,
 * revoked, unknown or soft-deleted lead's token resolves to null, so a lapsed
 * link cannot act on a lead any more than an invented one can.
 */
export async function resolveReportToken(token: string): Promise<{ leadId: number } | null> {
  if (!token) return null;
  try {
    const rows = await db
      .select({
        id: leads.id,
        token: leads.reportToken,
        expiresAt: leads.reportTokenExpiresAt,
        revokedAt: leads.reportTokenRevokedAt,
        isDeleted: leads.isDeleted,
      })
      .from(leads)
      .where(eq(leads.reportToken, token))
      .limit(1);
    const row = rows[0];
    if (!row || row.isDeleted) return null;
    if (!isReportTokenUsable(row)) return null;
    return { leadId: row.id };
  } catch (err) {
    console.error('[reportAccess] resolveReportToken failed:', err);
    return null;
  }
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

/**
 * Resolve a report token → the subject-property context (or null if the
 * capability is not live). This is the ONLY function that turns a token into
 * the lead's own contact details, and it runs behind resolveReportToken.
 */
export async function getReportContext(token: string): Promise<ReportContext | null> {
  const resolved = await resolveReportToken(token);
  if (!resolved) return null;
  try {
    const rows = await db.select().from(leads).where(eq(leads.id, resolved.leadId)).limit(1);
    const lead = rows[0];
    if (!lead) return null;
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
