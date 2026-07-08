/**
 * Server-only loader for the tier cohort. Kept separate from lib/scoreTiers.ts
 * (which is pure) so client components can import the tier math without pulling
 * in the DB client.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { agents } from '../drizzle/schema';
import type { TierContext } from './scoreTiers';

/** Load active agents' lifetime scores (ascending) for percentile tiering. */
export async function loadTierContext(): Promise<TierContext> {
  try {
    const rows = await db
      .select({ s: agents.scoreLifetime })
      .from(agents)
      .where(eq(agents.isActive, true));
    const sortedScores = rows.map((r) => r.s ?? 0).sort((a, b) => a - b);
    return { sortedScores };
  } catch {
    return { sortedScores: [] };
  }
}
