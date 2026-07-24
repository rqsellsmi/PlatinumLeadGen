/**
 * Google Ads offline-conversion export worker. Selects due outbox rows, joins
 * the lead, applies eligibility, sends one events:ingest per row via the Data
 * Manager client, and persists the outcome. Runs from a cron endpoint outside
 * any agent request (a Google outage can't delay or lose a milestone).
 *
 * State machine on google_ads_conversion_outbox.export_status:
 *   pending  → submitted (sent ok) | error (retryable) | ineligible
 *   error    → retried while next_retry_at is set + due; next_retry_at cleared
 *              (null) once permanent or attempts exhausted (won't be re-picked)
 *   submitted = delivered to Google, awaiting processing confirmation. Promotion
 *              to accepted via requestStatus polling is a documented follow-up
 *              (needs the live endpoint, same first-connection boundary as IDX).
 *
 * Relative imports (vitest `@/` trap, lessons §17). Never logs the payload.
 */
import { and, eq, or, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { googleAdsConversionOutbox, leads } from '../drizzle/schema';
import {
  googleAdsConfigured,
  googleAdsCustomerId,
  conversionActionId,
  consentValue,
  validateOnly,
  eligibleLeadTypes,
  type OutboxMilestone,
} from './googleAdsConfig';
import { buildIngestRequest, isExportEligible } from './googleAdsOutbox';
import { dataManagerIngest } from './googleAdsClient';

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000; // 1 min, doubled per attempt, +20% jitter

function backoffMs(attempts: number): number {
  const base = BASE_BACKOFF_MS * 2 ** Math.min(attempts, 8);
  return base + base * 0.2 * Math.random();
}

export interface DispatchSummary {
  processed: number;
  submitted: number;
  ineligible: number;
  errored: number;
  waitingOnActionId: number;
  skipped?: string;
}

export async function dispatchGoogleAdsConversions(opts?: {
  now?: Date;
  limit?: number;
}): Promise<DispatchSummary> {
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 50;
  const summary: DispatchSummary = {
    processed: 0,
    submitted: 0,
    ineligible: 0,
    errored: 0,
    waitingOnActionId: 0,
  };
  if (!googleAdsConfigured()) return { ...summary, skipped: 'not-configured' };

  const customerId = googleAdsCustomerId();
  const allowlist = eligibleLeadTypes();

  // Pending rows, plus errored rows whose backoff is due (never permanent ones,
  // which have next_retry_at cleared to null).
  const rows = await db
    .select()
    .from(googleAdsConversionOutbox)
    .where(
      or(
        eq(googleAdsConversionOutbox.exportStatus, 'pending'),
        and(
          eq(googleAdsConversionOutbox.exportStatus, 'error'),
          isNotNull(googleAdsConversionOutbox.nextRetryAt),
          lte(googleAdsConversionOutbox.nextRetryAt, now),
        ),
      ),
    )
    .orderBy(googleAdsConversionOutbox.createdAt)
    .limit(limit);

  for (const row of rows) {
    summary.processed += 1;

    const leadRows = await db
      .select({
        leadType: leads.leadType,
        isDeleted: leads.isDeleted,
        gclid: leads.gclid,
        gbraid: leads.gbraid,
        wbraid: leads.wbraid,
        email: leads.email,
        phone: leads.phone,
      })
      .from(leads)
      .where(eq(leads.id, row.leadId))
      .limit(1);
    const lead = leadRows[0];

    if (!lead) {
      await markIneligible(row.id, 'lead-missing', now);
      summary.ineligible += 1;
      continue;
    }
    if (!isExportEligible(lead, allowlist)) {
      await markIneligible(row.id, `ineligible: type=${lead.leadType} deleted=${lead.isDeleted}`, now);
      summary.ineligible += 1;
      continue;
    }

    // Re-resolve the action id from config (source of truth), fall back to the
    // value captured at enqueue. Missing = config not finished: leave the row
    // pending (don't burn the retry budget) and check again next run.
    const actionId = conversionActionId(row.milestone as OutboxMilestone) || row.conversionActionId || '';
    if (!actionId) {
      summary.waitingOnActionId += 1;
      continue;
    }

    const body = buildIngestRequest({
      customerId,
      conversionActionId: actionId,
      transactionId: row.transactionId,
      occurredAt: row.occurredAt,
      eventSource: row.eventSource,
      lead: {
        gclid: lead.gclid,
        gbraid: lead.gbraid,
        wbraid: lead.wbraid,
        email: lead.email,
        phone: lead.phone,
      },
      consent: consentValue(),
      validateOnly: validateOnly(),
    });

    const result = await dataManagerIngest(body);

    if (result.ok) {
      await db
        .update(googleAdsConversionOutbox)
        .set({
          exportStatus: 'submitted',
          googleRequestId: result.requestId ?? null,
          conversionActionId: actionId,
          submittedAt: now,
          nextRetryAt: null,
          lastError: null,
          exportAttempts: row.exportAttempts + 1,
          updatedAt: now,
        })
        .where(eq(googleAdsConversionOutbox.id, row.id));
      summary.submitted += 1;
    } else {
      const attempts = row.exportAttempts + 1;
      const giveUp = !result.retryable || attempts >= MAX_ATTEMPTS;
      await db
        .update(googleAdsConversionOutbox)
        .set({
          exportStatus: 'error',
          exportAttempts: attempts,
          lastError: (result.error ?? `HTTP ${result.status}`).slice(0, 500),
          // Permanent failure / exhausted → clear next_retry_at so it isn't
          // re-picked; the daily reconciliation still surfaces it for a human.
          nextRetryAt: giveUp ? null : new Date(now.getTime() + backoffMs(attempts)),
          updatedAt: now,
        })
        .where(eq(googleAdsConversionOutbox.id, row.id));
      summary.errored += 1;
    }
  }

  return summary;
}

async function markIneligible(id: number, reason: string, now: Date): Promise<void> {
  await db
    .update(googleAdsConversionOutbox)
    .set({ exportStatus: 'ineligible', lastError: reason.slice(0, 500), nextRetryAt: null, updatedAt: now })
    .where(eq(googleAdsConversionOutbox.id, id));
}

/** Outbox counts by export_status — for the admin visibility card + reconciliation. */
export async function googleAdsOutboxStatusCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: googleAdsConversionOutbox.exportStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(googleAdsConversionOutbox)
    .groupBy(googleAdsConversionOutbox.exportStatus);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
