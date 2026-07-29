/**
 * Shared agent-availability logic so the agent's own portal toggle
 * (POST /api/agent/availability) and the admin toggle (Admin → Agents) do the
 * IDENTICAL thing — set `isAvailable`, record queue membership on the first
 * opt-in, and grant the one-time first-activation head start.
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

export async function setAgentAvailability(agentId: number, available: boolean): Promise<void> {
  await db
    .update(agents)
    .set({ isAvailable: available, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  if (available) {
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
