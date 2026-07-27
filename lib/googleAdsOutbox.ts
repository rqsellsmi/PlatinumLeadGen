/**
 * Google Ads offline-conversion outbox — the CRM-side domain logic.
 *
 * `recordStatusUpdate` calls `enqueueGoogleAdsConversion` when a lead first
 * enters Nurturing / Signed / Closed; the export worker (lib/googleAdsWorker.ts)
 * later delivers pending rows to the Data Manager API. The once-only guard is
 * the outbox UNIQUE(lead_id, milestone) index — enqueue on every entry, ON
 * CONFLICT DO NOTHING (design §5.2). No atomic claim, no transaction.
 *
 * Pure helpers (milestoneFor / transactionIdFor / eventSourceFor / isExportEligible
 * / buildIngestRequest) are DB-free and unit-tested; only enqueue touches the DB.
 * Relative imports (vitest `@/` alias trap, lessons §17).
 */
import { db } from './db';
import { googleAdsConversionOutbox } from '../drizzle/schema';
import {
  conversionActionId,
  consentValue,
  eligibleLeadTypes,
  googleAdsConfigured,
  type ConsentValue,
  type OutboxMilestone,
} from './googleAdsConfig';
import { hashedEmail, hashedPhone } from './googleAdsHash';

export type UpdateChannel = 'web' | 'phone' | 'other';

/** Map a lead status to its pipeline conversion milestone, or null if not a trigger. */
export function milestoneFor(status: string): OutboxMilestone | null {
  switch (status) {
    case 'nurturing':
      return 'valid_seller_lead';
    case 'signed':
      return 'listing_signed';
    case 'closed':
      return 'closed';
    default:
      return null;
  }
}

/** Map a lead type to its website/acquisition conversion milestone, or null. */
export function acquisitionMilestoneFor(leadType: string | null | undefined): OutboxMilestone | null {
  switch (leadType) {
    case 'valuation':
      return 'seller_valuation';
    case 'seller_guide':
      return 'guide_download';
    default:
      return null; // 'webhook' and anything else: no acquisition conversion
  }
}

/** Deterministic Google dedup key. Stable across every retry. */
export function transactionIdFor(leadId: number, milestone: OutboxMilestone): string {
  return `lead:${leadId}:${milestone}`;
}

/** Data Manager eventSource from the CRM update channel. */
export function eventSourceFor(channel: UpdateChannel | null | undefined): 'PHONE' | 'WEB' | 'OTHER' {
  if (channel === 'phone') return 'PHONE';
  if (channel === 'web') return 'WEB';
  return 'OTHER';
}

/** Export eligibility: not soft-deleted and an approved lead type (decision D11). */
export function isExportEligible(
  lead: { isDeleted?: boolean | null; leadType?: string | null },
  allowlist: string[] = eligibleLeadTypes(),
): boolean {
  if (lead.isDeleted) return false;
  return Boolean(lead.leadType) && allowlist.includes(lead.leadType as string);
}

export interface OutboxLeadIdentifiers {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface BuildIngestInput {
  customerId: string;
  conversionActionId: string;
  transactionId: string;
  occurredAt: Date;
  eventSource: string;
  lead: OutboxLeadIdentifiers;
  consent?: ConsentValue;
  validateOnly?: boolean;
}

/**
 * Build the Data Manager `events:ingest` request body (vendor §8). Pure — no
 * network. Click ids are sent RAW (never hashed); email/phone are SHA-256 hex.
 * userData/encoding are only included when at least one hashed identifier exists.
 */
export function buildIngestRequest(input: BuildIngestInput): Record<string, unknown> {
  const adIdentifiers: Record<string, string> = {};
  if (input.lead.gclid) adIdentifiers.gclid = input.lead.gclid;
  if (input.lead.gbraid) adIdentifiers.gbraid = input.lead.gbraid;
  if (input.lead.wbraid) adIdentifiers.wbraid = input.lead.wbraid;

  const userIdentifiers: Array<Record<string, string>> = [];
  const eHash = hashedEmail(input.lead.email);
  const pHash = hashedPhone(input.lead.phone);
  if (eHash) userIdentifiers.push({ emailAddress: eHash });
  if (pHash) userIdentifiers.push({ phoneNumber: pHash });

  const consent = input.consent ?? consentValue();

  const event: Record<string, unknown> = {
    transactionId: input.transactionId,
    eventTimestamp: input.occurredAt.toISOString(), // RFC-3339 Z (UTC)
    eventSource: input.eventSource,
  };
  // Only send a consent object when we actually have a signal. "Unspecified"
  // (US/first-party default) is omitted — the Data Manager ConsentStatus enum has
  // no CONSENT_STATUS_UNSPECIFIED member, and an explicit unspecified adds nothing.
  if (consent === 'CONSENT_GRANTED' || consent === 'CONSENT_DENIED') {
    event.consent = { adUserData: consent, adPersonalization: consent };
  }
  if (Object.keys(adIdentifiers).length > 0) event.adIdentifiers = adIdentifiers;
  if (userIdentifiers.length > 0) event.userData = { userIdentifiers };

  const body: Record<string, unknown> = {
    destinations: [
      {
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: input.customerId },
        productDestinationId: input.conversionActionId,
      },
    ],
    events: [event],
    validateOnly: Boolean(input.validateOnly),
  };
  if (userIdentifiers.length > 0) body.encoding = 'HEX';
  return body;
}

/**
 * Insert one outbox row. Best-effort — never throws (a Google-outbox hiccup must
 * not break the surrounding request). No-ops until the integration is configured.
 * The UNIQUE(lead_id, milestone) index makes a repeat enqueue a silent no-op.
 */
async function insertOutboxRow(o: {
  leadId: number;
  milestone: OutboxMilestone;
  sourceEventId?: number | null;
  occurredAt: Date;
  channel?: UpdateChannel;
}): Promise<void> {
  if (!googleAdsConfigured()) return; // no-op until creds are set (current-state §4.7 posture)
  try {
    await db
      .insert(googleAdsConversionOutbox)
      .values({
        leadId: o.leadId,
        sourceEventId: o.sourceEventId ?? null,
        milestone: o.milestone,
        occurredAt: o.occurredAt,
        eventSource: eventSourceFor(o.channel),
        conversionActionId: conversionActionId(o.milestone) || null,
        transactionId: transactionIdFor(o.leadId, o.milestone),
        exportStatus: 'pending',
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error(`[googleAdsOutbox] enqueue failed for lead ${o.leadId} (${o.milestone}):`, err);
  }
}

/**
 * Pipeline conversion — first entry into Nurturing / Signed / Closed. Called
 * from recordStatusUpdate. No-ops for non-trigger statuses.
 */
export async function enqueueGoogleAdsConversion(o: {
  leadId: number;
  sourceEventId?: number | null;
  status: string;
  occurredAt: Date;
  channel?: UpdateChannel;
}): Promise<void> {
  const milestone = milestoneFor(o.status);
  if (!milestone) return;
  await insertOutboxRow({ ...o, milestone });
}

/**
 * Website/acquisition conversion — the lead was captured via a form. Called
 * from the lead-submit route. `seller_valuation` for valuation leads,
 * `guide_download` for seller_guide leads; no-ops for anything else.
 */
export async function enqueueGoogleAdsAcquisition(o: {
  leadId: number;
  leadType: string | null | undefined;
  sourceEventId?: number | null;
  occurredAt: Date;
}): Promise<void> {
  const milestone = acquisitionMilestoneFor(o.leadType);
  if (!milestone) return;
  await insertOutboxRow({
    leadId: o.leadId,
    milestone,
    sourceEventId: o.sourceEventId,
    occurredAt: o.occurredAt,
    channel: 'web',
  });
}

/** Appointment-requested conversion — called from the appointments route. */
export async function enqueueGoogleAdsAppointment(o: {
  leadId: number;
  sourceEventId?: number | null;
  occurredAt: Date;
}): Promise<void> {
  await insertOutboxRow({
    leadId: o.leadId,
    milestone: 'appointment_requested',
    sourceEventId: o.sourceEventId,
    occurredAt: o.occurredAt,
    channel: 'web',
  });
}
