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
import { buildRotationList, type RoutingAgent } from './routing';

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

function sameSet(a: number[], b: number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Get the routing queue, auto-rebuilding (freshly interleaved) when the
 * routable-agent set changed. `available` = active AND available agents (already
 * filtered by the caller). Pointer is always 0 — the list front is "next".
 */
export async function getRoutingQueue(
  available: RoutingAgent[],
): Promise<{ rotationList: number[]; pointer: number }> {
  const current = await readQueue();
  const freshList = buildRotationList(available);
  const availIds = available.map((a) => a.id);

  if (!current) {
    await writeQueue(freshList, null);
    return { rotationList: freshList, pointer: 0 };
  }

  const distinctCurrent = Array.from(new Set(current.rotationList));
  if (!sameSet(distinctCurrent, availIds)) {
    // Roster changed (e.g. an agent activated) — rebuild interleaved so new
    // agents' slots weave in rather than clustering at the end.
    await writeQueue(freshList, current.id);
    return { rotationList: freshList, pointer: 0 };
  }

  return { rotationList: current.rotationList, pointer: 0 };
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
