/**
 * Shared agent-availability logic so the agent's own portal toggle
 * (POST /api/agent/availability) and the admin toggle (Admin → Agents) do the
 * IDENTICAL thing — set `isAvailable` and, on turning it ON, grant the one-time
 * first-activation queue head start.
 *
 * Availability = the soft "take new leads / pause new leads" switch. It does NOT
 * block login or roster membership (that's `isActive`, the admin lockout).
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { agents } from '../drizzle/schema';
import { grantStartingCreditIfFirstActivation } from './scoring';

export async function setAgentAvailability(agentId: number, available: boolean): Promise<void> {
  await db
    .update(agents)
    .set({ isAvailable: available, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  if (available) {
    // One-time queue head start (rolling-365 only) — best-effort, must never
    // break the toggle itself. Same call the agent route made.
    try {
      await grantStartingCreditIfFirstActivation(agentId);
    } catch (err) {
      console.error('[agentAvailability] starting credit failed', { agentId, err });
    }
  }
}
