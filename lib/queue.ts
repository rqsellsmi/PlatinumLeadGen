/**
 * Persisted weighted round-robin queue (v1.6 §G.2).
 *
 * agent_queue holds the rotation list (agent ids with slot duplicates). The
 * routing engine reads from it so an admin's manual reorder is honored, and
 * writes back the mutated list after each selection (the served slot moves to
 * the back; distance-skipped slots stay at the front). The queue auto-rebuilds
 * when the set of routable agents changes.
 *
 * The list is now self-ordering — front = next — so `pointer` is vestigial and
 * always persisted as 0. It's kept in the schema (and returned as 0) so existing
 * readers that scan from the pointer keep working.
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { agentQueue } from '../drizzle/schema';
import { buildRotationList, reconcileRotation, type RoutingAgent } from './routing';

export interface QueueRow {
  id: number;
  rotationList: number[];
  pointer: number;
  lastRebuilt: Date | null;
}

export async function readQueue(): Promise<QueueRow | null> {
  const rows = await db.select().from(agentQueue).limit(1);
  if (!rows[0]) return null;
  let list: number[] = [];
  try {
    const parsed = JSON.parse(rows[0].rotationList);
    if (Array.isArray(parsed)) list = parsed.filter((n) => typeof n === 'number');
  } catch {
    /* ignore malformed */
  }
  return { id: rows[0].id, rotationList: list, pointer: rows[0].pointer, lastRebuilt: rows[0].lastRebuilt };
}

async function writeQueue(rotationList: number[], id: number | null): Promise<void> {
  const now = new Date();
  if (id != null) {
    await db
      .update(agentQueue)
      .set({ rotationList: JSON.stringify(rotationList), pointer: 0, lastRebuilt: now })
      .where(eq(agentQueue.id, id));
  } else {
    await db.insert(agentQueue).values({ rotationList: JSON.stringify(rotationList), pointer: 0, lastRebuilt: now });
  }
}

function sameOrder(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Get the routing queue, RECONCILING it with the current routable set in place
 * rather than rebuilding from scratch — so the live order and move-to-back
 * progress survive roster/score changes (new agents weave in; removed agents
 * and score-decrease extras drop out). `available` = active AND available agents
 * (already filtered by the caller). Pointer is always 0 — front is "next".
 */
export async function getRoutingQueue(
  available: RoutingAgent[],
): Promise<{ rotationList: number[]; pointer: number }> {
  const current = await readQueue();

  if (!current) {
    const freshList = buildRotationList(available);
    await writeQueue(freshList, null);
    return { rotationList: freshList, pointer: 0 };
  }

  const reconciled = reconcileRotation(current.rotationList, available);
  if (!sameOrder(reconciled, current.rotationList)) {
    await writeQueue(reconciled, current.id);
  }
  return { rotationList: reconciled, pointer: 0 };
}

/** Persist the mutated rotation list returned by recommendAgents. */
export async function persistQueue(rotationList: number[]): Promise<void> {
  const current = await readQueue();
  await writeQueue(rotationList, current?.id ?? null);
}

/** Save an admin-reordered rotation list. */
export async function saveQueueOrder(rotationList: number[]): Promise<void> {
  const current = await readQueue();
  await writeQueue(rotationList, current?.id ?? null);
}

/** Recompute the rotation (freshly interleaved) from current agents/scores. */
export async function rebuildQueue(
  available: RoutingAgent[],
): Promise<{ rotationList: number[]; pointer: number }> {
  const current = await readQueue();
  const freshList = buildRotationList(available);
  await writeQueue(freshList, current?.id ?? null);
  return { rotationList: freshList, pointer: 0 };
}
