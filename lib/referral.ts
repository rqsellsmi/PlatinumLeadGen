/**
 * Referral-fee resolution (migration 0038). A buyer lead is `referral_status`:
 *   - eligible        the brokerage's 30% referral is owed (default for all
 *                     site-generated leads)
 *   - pending_review  the buyer claimed one of our agents; the lead's points are
 *                     HELD (logged, excluded from totals) until an admin decides
 *   - exempt          admin confirmed a pre-existing client — no referral owed,
 *                     and the held points stay excluded permanently
 *
 * resolveReferral is the single admin action that leaves pending_review. On
 * `eligible` it releases the held score-log rows into the agent's totals; on
 * `exempt` it leaves them held so they never count. Idempotent: only a
 * pending_review lead is acted on.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { agents, agentScoreLog, leads } from '../drizzle/schema';
import { recomputeRolling365 } from './scoring';
import { logLeadEvent } from './leadEvents';

export type ReferralDecision = 'eligible' | 'exempt';

export interface ResolveReferralResult {
  ok: boolean;
  reason?: 'lead-not-found' | 'not-pending';
  released?: number; // total delta folded into agent totals (eligible only)
}

/** Pure: net sum of a lead's held score-log deltas, per agent. Unit-tested. */
export function sumHeldByAgent(
  rows: { agentId: number; delta: number }[],
): Map<number, number> {
  const byAgent = new Map<number, number>();
  for (const r of rows) byAgent.set(r.agentId, (byAgent.get(r.agentId) ?? 0) + r.delta);
  return byAgent;
}

/**
 * Resolve a lead's pending referral. `eligible` releases its held points into the
 * owning agents' lifetime/ytd/monthly + rolling-365; `exempt` leaves them held.
 * Either way the lead moves out of pending_review and is stamped resolved.
 */
export async function resolveReferral(
  leadId: number,
  decision: ReferralDecision,
  adminId?: number,
): Promise<ResolveReferralResult> {
  const leadRows = await db
    .select({ id: leads.id, referralStatus: leads.referralStatus })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  const lead = leadRows[0];
  if (!lead) return { ok: false, reason: 'lead-not-found' };
  if (lead.referralStatus !== 'pending_review') return { ok: false, reason: 'not-pending' };

  const now = new Date();
  let released = 0;

  if (decision === 'eligible') {
    // Gather this lead's still-held rows and fold them into each owner's totals.
    const heldRows = await db
      .select({ agentId: agentScoreLog.agentId, delta: agentScoreLog.delta })
      .from(agentScoreLog)
      .where(and(eq(agentScoreLog.leadId, leadId), eq(agentScoreLog.isHeld, true)));
    const byAgent = sumHeldByAgent(heldRows);

    // Flip the held flag first so the rolling-365 recompute counts them.
    await db
      .update(agentScoreLog)
      .set({ isHeld: false })
      .where(and(eq(agentScoreLog.leadId, leadId), eq(agentScoreLog.isHeld, true)));

    for (const [agentId, sum] of byAgent) {
      released += sum;
      await db
        .update(agents)
        .set({
          scoreLifetime: sql`${agents.scoreLifetime} + ${sum}`,
          scoreYtd: sql`${agents.scoreYtd} + ${sum}`,
          scoreMonthly: sql`${agents.scoreMonthly} + ${sum}`,
          score: sql`${agents.scoreLifetime} + ${sum}`,
          updatedAt: now,
        })
        .where(eq(agents.id, agentId));
      await recomputeRolling365(agentId, now);
    }
  }
  // exempt: held rows are left as-is (is_held=true) → excluded from totals forever.

  await db
    .update(leads)
    .set({
      referralStatus: decision,
      referralResolvedBy: adminId ?? null,
      referralResolvedAt: now,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));

  await logLeadEvent(
    leadId,
    'referral_resolved',
    decision === 'eligible'
      ? `Referral confirmed eligible — held points released (${released >= 0 ? '+' : ''}${released})`
      : 'Referral marked exempt (pre-existing client) — held points excluded',
  );

  return { ok: true, released };
}
