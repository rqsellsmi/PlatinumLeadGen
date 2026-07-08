/**
 * Lead routing engine (Section 5.1 / 5.2).
 *
 * Weighted round-robin with a PROXIMITY-FIRST correction (the "Dearborn bug" fix,
 * Section 5.2): the old system walked the queue first and applied proximity as a
 * secondary filter, so a far agent could be offered a lead before a nearer one.
 * The corrected algorithm builds the proximity pool first and only stops the
 * queue walk at agents inside that pool.
 */

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in miles. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

/**
 * Number of slots an agent occupies in the weighted rotation list, from their
 * rolling-90d score (spec v2 §3): diminishing returns, no upper cap.
 *   slots = 1 + floor( sqrt( max(score, 0) / 10 ) )
 * Each additional slot costs progressively more, so score always matters but the
 * top of the range doesn't need arbitrary capping. Minimum 1.
 */
export function slotCountForScore(score: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(score || 0, 0) / 10));
}

export interface RoutingAgent {
  id: number;
  /** Effective latitude (custom anchor or office) — may be null. */
  lat: number | null;
  /** Effective longitude (custom anchor or office) — may be null. */
  lng: number | null;
  score: number;
  /** Per-agent acceptance radius in miles. Undefined → use the global default. */
  radiusMiles?: number | null;
}

/**
 * Build the weighted round-robin rotation list: each agent id appears
 * slotCountForScore(score) times, but the slots are INTERLEAVED (evenly spaced)
 * rather than clustered per agent. Each of an agent's slots is placed at the
 * fractional position (k + 0.5) / slotCount across [0,1); merging all agents'
 * slots by that position spreads every agent's turns through the list.
 *
 * This matters when an agent is (re)activated: their slots weave in among the
 * others instead of landing together at the end of the queue. Deterministic —
 * ties in position break by agent id.
 */
export function buildRotationList(agents: RoutingAgent[]): number[] {
  const sorted = [...agents].sort((a, b) => a.id - b.id);
  const slots: { id: number; pos: number }[] = [];
  for (const agent of sorted) {
    const count = slotCountForScore(agent.score);
    for (let k = 0; k < count; k++) {
      slots.push({ id: agent.id, pos: (k + 0.5) / count });
    }
  }
  slots.sort((a, b) => a.pos - b.pos || a.id - b.id);
  return slots.map((s) => s.id);
}

/**
 * Reconcile an existing queue with the current routable set WITHOUT rebuilding
 * from scratch — preserving the live order (and move-to-back progress). Existing
 * slots keep their relative order; extras from a score decrease and slots for
 * now-unavailable agents are dropped; new agents (or extra slots from a score
 * increase) are woven in evenly rather than appended at the end.
 */
export function reconcileRotation(current: number[], available: RoutingAgent[]): number[] {
  const desired = new Map<number, number>();
  for (const a of available) desired.set(a.id, slotCountForScore(a.score));

  // Keep existing occurrences up to the desired count, preserving order.
  const keptCount = new Map<number, number>();
  const kept: number[] = [];
  for (const id of current) {
    const want = desired.get(id) ?? 0;
    const have = keptCount.get(id) ?? 0;
    if (have < want) {
      kept.push(id);
      keptCount.set(id, have + 1);
    }
  }

  // Additions: brand-new agents, or extra slots from a score increase. Give each
  // agent's additions evenly-spaced positions; existing slots hold their order.
  const slots: { id: number; pos: number; isNew: boolean }[] = kept.map((id, i) => ({
    id,
    pos: kept.length > 0 ? (i + 0.5) / kept.length : 0,
    isNew: false,
  }));
  let anyAdd = false;
  for (const a of available) {
    const add = (desired.get(a.id) ?? 0) - (keptCount.get(a.id) ?? 0);
    for (let k = 0; k < add; k++) {
      anyAdd = true;
      slots.push({ id: a.id, pos: (k + 0.5) / add, isNew: true });
    }
  }
  if (!anyAdd) return kept;

  // Stable merge by position; ties keep existing slots ahead of new ones.
  slots.sort((x, y) => x.pos - y.pos || Number(x.isNew) - Number(y.isNew) || x.id - y.id);
  return slots.map((s) => s.id);
}

export interface RecommendParams {
  agents: RoutingAgent[];
  /** Lead property coordinates. If either is null, proximity is skipped. */
  propertyLat: number | null;
  propertyLng: number | null;
  radiusMiles: number;
  /** Agent ids to exclude (prior offer recipients on reassignment). */
  excludedAgentIds?: Set<number> | number[];
  /**
   * The current queue as an ordered list of slots (agent ids with slot
   * duplicates), front = next. When provided it is used as-is (honoring an
   * admin's manual reorder); non-eligible ids are dropped, and if nothing
   * eligible remains it falls back to a freshly built rotation.
   */
  rotationList?: number[];
}

export interface RecommendResult {
  /** The chosen agent, or null if no eligible agent exists. */
  agentId: number | null;
  /**
   * The queue AFTER this selection: the served slot is moved to the back, and
   * any slots skipped for distance stay at the front. Persist this. Empty only
   * when no eligible agent exists.
   */
  rotationList: number[];
  /** Distance in miles from agent to property, when both have coordinates. */
  distanceMiles: number | null;
  /** Whether selection came from the proximity pool (false = global fallback). */
  usedProximity: boolean;
}

/**
 * Select the next agent for a lead (proximity-first) and return the mutated
 * queue.
 *
 * The queue is served from the FRONT. When there's a proximity pool, out-of-range
 * slots at the front are skipped and the first in-range slot is served; the
 * skipped slots stay put, so those agents are reconsidered first for the next
 * lead — a distance skip never costs an agent their turn. The one served slot is
 * moved to the back. With no pool (no lead coords, or nobody in range), the front
 * slot is served and moved to the back (plain round-robin).
 */
export function recommendAgents(params: RecommendParams): RecommendResult {
  const { agents, propertyLat, propertyLng, radiusMiles } = params;
  const excluded =
    params.excludedAgentIds instanceof Set
      ? params.excludedAgentIds
      : new Set(params.excludedAgentIds ?? []);

  const eligible = agents.filter((a) => !excluded.has(a.id));
  const eligibleIds = new Set(eligible.map((a) => a.id));

  // Working rotation: a provided order (filtered to eligible) or a fresh build.
  let rotation: number[];
  if (params.rotationList && params.rotationList.length > 0) {
    rotation = params.rotationList.filter((id) => eligibleIds.has(id));
    if (rotation.length === 0) rotation = buildRotationList(eligible);
  } else {
    rotation = buildRotationList(eligible);
  }

  if (eligible.length === 0 || rotation.length === 0) {
    return { agentId: null, rotationList: rotation, distanceMiles: null, usedProximity: false };
  }

  const hasLeadCoords = propertyLat != null && propertyLng != null;

  // Distance map + proximity pool — each agent is in the pool when the lead is
  // within THAT agent's own radius (falling back to the global default). Empty
  // if no lead coords.
  const distanceById = new Map<number, number>();
  const proximityPool = new Set<number>();
  if (hasLeadCoords) {
    for (const a of eligible) {
      if (a.lat != null && a.lng != null) {
        const dist = haversine(propertyLat!, propertyLng!, a.lat, a.lng);
        distanceById.set(a.id, dist);
        if (dist <= (a.radiusMiles ?? radiusMiles)) proximityPool.add(a.id);
      }
    }
  }

  // Find the slot to serve: first in-range slot when a pool exists (skipping
  // out-of-range slots), else the front slot.
  let servedIndex = 0;
  let usedProximity = false;
  if (proximityPool.size > 0) {
    const idx = rotation.findIndex((id) => proximityPool.has(id));
    if (idx >= 0) {
      servedIndex = idx;
      usedProximity = true;
    }
  }

  const agentId = rotation[servedIndex];

  // Move the served slot to the back; skipped (front) slots keep their place.
  const newRotation = rotation.slice();
  newRotation.splice(servedIndex, 1);
  newRotation.push(agentId);

  return {
    agentId,
    rotationList: newRotation,
    distanceMiles: distanceById.get(agentId) ?? null,
    usedProximity,
  };
}
