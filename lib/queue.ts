/**
 * Persisted weighted round-robin queue (v1.6 §G.2).
 *
 * agent_queue holds the rotation list (agent ids with slot duplicates) and the
 * pointer. The routing engine reads from it so an admin's manual reorder is
 * honored; it auto-rebuilds when the set of routable agents changes.
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

async function writeQueue(rotationList: number[], pointer: number, id: number | null): Promise<void> {
  const now = new Date();
  const safePointer = rotationList.length > 0 ? ((pointer % rotationList.length) + rotationList.length) % rotationList.length : 0;
  if (id != null) {
    await db
      .update(agentQueue)
      .set({ rotationList: JSON.stringify(rotationList), pointer: safePointer, lastRebuilt: now })
      .where(eq(agentQueue.id, id));
  } else {
    await db.insert(agentQueue).values({ rotationList: JSON.stringify(rotationList), pointer: safePointer, lastRebuilt: now });
  }
}

function sameSet(a: number[], b: number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** Pointer that keeps pointing at the same agent after the list changes. */
function preservedPointer(prev: QueueRow | null, list: number[]): number {
  if (!prev || prev.rotationList.length === 0 || list.length === 0) return 0;
  const agent = prev.rotationList[prev.pointer % prev.rotationList.length];
  const idx = list.indexOf(agent);
  return idx >= 0 ? idx : 0;
}

/**
 * Get the routing queue, auto-rebuilding when the routable-agent set changed.
 * `available` = active AND available agents (already filtered by the caller).
 */
export async function getRoutingQueue(
  available: RoutingAgent[],
): Promise<{ rotationList: number[]; pointer: number }> {
  const current = await readQueue();
  const freshList = buildRotationList(available);
  const availIds = available.map((a) => a.id);

  if (!current) {
    await writeQueue(freshList, 0, null);
    return { rotationList: freshList, pointer: 0 };
  }

  const distinctCurrent = Array.from(new Set(current.rotationList));
  if (!sameSet(distinctCurrent, availIds)) {
    const pointer = preservedPointer(current, freshList);
    await writeQueue(freshList, pointer, current.id);
    return { rotationList: freshList, pointer };
  }

  return { rotationList: current.rotationList, pointer: current.pointer };
}

/** Persist the advanced pointer after a selection. */
export async function persistQueuePointer(pointer: number): Promise<void> {
  const current = await readQueue();
  if (current) await writeQueue(current.rotationList, pointer, current.id);
}

/** Save an admin-reordered rotation list (keeps pointer on the same agent). */
export async function saveQueueOrder(rotationList: number[]): Promise<void> {
  const current = await readQueue();
  const pointer = preservedPointer(current, rotationList);
  await writeQueue(rotationList, pointer, current?.id ?? null);
}

/** Recompute the rotation from current agents/scores and persist. */
export async function rebuildQueue(
  available: RoutingAgent[],
): Promise<{ rotationList: number[]; pointer: number }> {
  const current = await readQueue();
  const freshList = buildRotationList(available);
  const pointer = preservedPointer(current, freshList);
  await writeQueue(freshList, pointer, current?.id ?? null);
  return { rotationList: freshList, pointer };
}
