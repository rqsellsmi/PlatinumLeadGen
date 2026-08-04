/**
 * Pre-launch lead purge — delete every lead and everything derived from one,
 * while KEEPING the valuations table.
 *
 * Usage:
 *   tsx scripts/clear-leads.ts --dry-run     # counts only, changes nothing
 *   tsx scripts/clear-leads.ts --confirm     # performs the purge
 *
 * Deliberately a script, not a migration. A migration that deletes all leads
 * would re-run on any future restore or fresh environment and destroy real
 * data; this has to be an explicit, deliberate act.
 *
 * WHAT SURVIVES
 *   valuations            — kept by request. `lead_id` is NULLed rather than
 *                           the rows deleted (see below). The 30-day address
 *                           cache survives with them, so re-testing an address
 *                           already looked up will not re-bill the AVM provider.
 *   email_send_log        — the delivery record. Currently the only evidence of
 *   api_usage_logs          whether Graph/Gmail accepted anything, and of what
 *                           the APIs cost during testing.
 *
 * WHY valuations.lead_id IS NULLED
 *   It is a foreign key with no cascade, so leads cannot be deleted while it
 *   points at them. It is ALSO the reveal gate: getRevealedValuation() returns
 *   nothing when lead_id is null. Nulling it therefore re-gates every kept
 *   valuation, which is correct — those reports belonged to leads that no
 *   longer exist, and their report links should stop revealing detail.
 *
 * ORDER MATTERS. Three tables cascade from leads (lead_offers, status_updates,
 * lead_events); the rest hold non-cascading FKs and must be cleared first or
 * the delete fails.
 */
import './loadEnv';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  agentScoreLog,
  agents,
  appointmentRequests,
  googleAdsConversionOutbox,
  leadEvents,
  leadOffers,
  leads,
  locations,
  smsMessages,
  statusUpdates,
  valuations,
} from '../drizzle/schema';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirmed = args.includes('--confirm');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: any, label: string) {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  const n = Number(rows[0]?.n ?? 0);
  console.log(`  ${label.padEnd(32)} ${n}`);
  return n;
}

async function main() {
  if (!dryRun && !confirmed) {
    console.error(
      'Refusing to run without a flag.\n' +
        '  --dry-run   show what would be deleted\n' +
        '  --confirm   actually delete\n',
    );
    process.exit(1);
  }

  console.log(dryRun ? '\nDRY RUN — nothing will be changed.\n' : '\nPURGING LEAD DATA.\n');
  console.log('Current counts:');
  await count(leads, 'leads');
  await count(leadOffers, 'lead_offers');
  await count(leadEvents, 'lead_events');
  await count(statusUpdates, 'status_updates');
  await count(appointmentRequests, 'appointment_requests');
  await count(smsMessages, 'sms_messages');
  await count(googleAdsConversionOutbox, 'google_ads_outbox');
  await count(agentScoreLog, 'agent_score_log');
  const valuationCount = await count(valuations, 'valuations (KEPT)');

  if (dryRun) {
    console.log(
      `\nWould delete every row above except the ${valuationCount} valuation(s), ` +
        'whose lead_id would be set to NULL.\n',
    );
    return;
  }

  // ---- Clear the non-cascading references first --------------------------
  // Nulled, not deleted — this is the whole point of keeping valuations.
  await db.update(valuations).set({ leadId: null });
  console.log('\n✓ valuations.lead_id cleared (rows kept)');

  await db.delete(appointmentRequests);
  await db.delete(smsMessages);
  await db.delete(googleAdsConversionOutbox);
  console.log('✓ appointments, SMS, ads outbox deleted');

  // Points: every score row was earned on lead activity that no longer exists.
  await db.delete(agentScoreLog);
  await db
    .update(agents)
    .set({ score: 50, scoreLifetime: 50, scoreYtd: 0, scoreMonthly: 0, scoreRolling365: 0 });
  console.log('✓ agent score log cleared and scores reset to defaults');

  // ---- The leads themselves ----------------------------------------------
  // lead_offers, status_updates and lead_events cascade away with these.
  await db.delete(leads);
  console.log('✓ leads deleted (offers, events, status updates cascaded)');

  // Display counter fed by lead submissions — stale once the leads are gone.
  await db.update(locations).set({ valuationRequestsCount: 0 });
  console.log('✓ locations.valuation_requests_count reset');

  console.log('\nDone. Remaining:');
  await count(leads, 'leads');
  await count(valuations, 'valuations');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nclear-leads failed:', err);
    process.exit(1);
  });
