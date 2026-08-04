/**
 * Shared agent-availability logic so the agent's own portal toggle
 * (POST /api/agent/availability) and the admin toggle (Admin → Agents) do the
 * IDENTICAL thing — set `isAvailable`, record queue membership on the first
 * opt-in, and grant the one-time first-activation head start.
 *
 * ONE deliberate difference: only the agent's own toggle records referral-terms
 * acceptance (`recordOptIn`). See SetAvailabilityOptions.
 *
 * Availability = the soft "take new leads / pause new leads" switch. It does NOT
 * block login or roster membership (that's `isActive`, the admin lockout), and
 * since D7 it no longer controls QUEUE membership either — see the note on
 * `queueJoinedAt` below and lib/routing.ts.
 */
import { eq, isNull, and } from 'drizzle-orm';
import { db } from './db';
import { agents } from '../drizzle/schema';
import { grantStartingCreditIfFirstActivation } from './scoring';

export interface SetAvailabilityOptions {
  /**
   * True only when the AGENT flipped their own switch, which is the act that
   * accepts the 30% referral terms. Defaults to false so the admin toggle can
   * never manufacture a consent the agent never gave — a fabricated acceptance
   * record is worse than none at all.
   */
  recordOptIn?: boolean;
}

export async function setAgentAvailability(
  agentId: number,
  available: boolean,
  opts: SetAvailabilityOptions = {},
): Promise<void> {
  await db
    .update(agents)
    .set({ isAvailable: available, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  if (available) {
    // Referral-terms acceptance, recorded once and never overwritten. Same
    // atomic conditional-WHERE claim as the queue join below: later pauses and
    // resumes leave the original date alone, because the agreement was given
    // once and does not lapse.
    if (opts.recordOptIn) {
      try {
        await db
          .update(agents)
          .set({ availabilityOptedInAt: new Date() })
          .where(and(eq(agents.id, agentId), isNull(agents.availabilityOptedInAt)));
      } catch (err) {
        console.error('[agentAvailability] opt-in stamp failed', { agentId, err });
      }
    }

    // Record queue membership on the FIRST opt-in only (D7). This is what puts
    // the agent in the rotation and fixes their place in line; later pauses and
    // resumes leave it alone, which is precisely why toggling availability can
    // no longer move an agent forward. The conditional WHERE makes it an atomic
    // claim rather than a read-then-write, matching the starting-credit guard.
    try {
      await db
        .update(agents)
        .set({ queueJoinedAt: new Date() })
        .where(and(eq(agents.id, agentId), isNull(agents.queueJoinedAt)));
    } catch (err) {
      console.error('[agentAvailability] queue join failed', { agentId, err });
    }
    // One-time queue head start (rolling-365 only) — best-effort, must never
    // break the toggle itself. Same call the agent route made.
    try {
      await grantStartingCreditIfFirstActivation(agentId);
    } catch (err) {
      console.error('[agentAvailability] starting credit failed', { agentId, err });
    }
  }
}
