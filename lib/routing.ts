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
 * Number of slots an agent occupies in the weighted rotation list.
 * Higher score => more slots => more frequent offers. Minimum 1, capped at 5.
 */
export function slotCountForScore(score: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor((score || 0) / 15)));
}

export interface RoutingAgent {
  id: number;
  /** Effective latitude (own preferred, office fallback) — may be null. */
  lat: number | null;
  /** Effective longitude (own preferred, office fallback) — may be null. */
  lng: number | null;
  score: number;
}

/**
 * Build the weighted round-robin rotation list: each agent id repeated
 * slotCountForScore(score) times. Sorted by id for deterministic ordering so the
 * persisted queue pointer stays meaningful across calls.
 */
export function buildRotationList(agents: RoutingAgent[]): number[] {
  const sorted = [...agents].sort((a, b) => a.id - b.id);
  const list: number[] = [];
  for (const agent of sorted) {
    const slots = slotCountForScore(agent.score);
    for (let i = 0; i < slots; i++) list.push(agent.id);
  }
  return list;
}

export interface RecommendParams {
  agents: RoutingAgent[];
  /** Lead property coordinates. If either is null, proximity is skipped. */
  propertyLat: number | null;
  propertyLng: number | null;
  radiusMiles: number;
  /** Persisted round-robin pointer (index into the rotation list). */
  queuePointer: number;
  /** Agent ids to exclude (prior offer recipients on reassignment). */
  excludedAgentIds?: Set<number> | number[];
  /**
   * Persisted rotation list (agent ids with slot duplicates) from agent_queue
   * (v1.6 §G). When provided, it is used instead of rebuilding from scratch so
   * an admin's manual drag-reorder is honored. Non-eligible ids are skipped; if
   * nothing eligible remains, it falls back to a freshly built rotation.
   */
  rotationList?: number[];
}

export interface RecommendResult {
  /** The chosen agent, or null if no eligible agent exists. */
  agentId: number | null;
  /** New queue pointer to persist (Step 6 — advanced past the selected agent). */
  newQueuePointer: number;
  /** Distance in miles from agent to property, when both have coordinates. */
  distanceMiles: number | null;
  /** Whether selection came from the proximity pool (false = global fallback). */
  usedProximity: boolean;
}

/**
 * Select the next agent for a lead per the corrected proximity-first algorithm.
 */
export function recommendAgents(params: RecommendParams): RecommendResult {
  const { agents, propertyLat, propertyLng, radiusMiles, queuePointer } = params;
  const excluded =
    params.excludedAgentIds instanceof Set
      ? params.excludedAgentIds
      : new Set(params.excludedAgentIds ?? []);

  const eligible = agents.filter((a) => !excluded.has(a.id));
  if (eligible.length === 0) {
    return { agentId: null, newQueuePointer: queuePointer, distanceMiles: null, usedProximity: false };
  }

  const hasLeadCoords = propertyLat != null && propertyLng != null;

  // Distance map (only when lead + agent both have coordinates).
  const distanceById = new Map<number, number>();
  if (hasLeadCoords) {
    for (const a of eligible) {
      if (a.lat != null && a.lng != null) {
        distanceById.set(a.id, haversine(propertyLat!, propertyLng!, a.lat, a.lng));
      }
    }
  }

  // Step 3: proximity pool — agents within radius. Empty if no lead coords.
  const proximityPool = new Set<number>();
  if (hasLeadCoords) {
    for (const [id, dist] of distanceById) {
      if (dist <= radiusMiles) proximityPool.add(id);
    }
  }

  // The rotation list spans ALL eligible agents (Step 5 fallback uses the same
  // list). A persisted custom order is honored when provided (§G), filtered to
  // currently-eligible agents; otherwise it's built from scratch.
  const eligibleIds = new Set(eligible.map((a) => a.id));
  let rotation: number[];
  if (params.rotationList && params.rotationList.length > 0) {
    rotation = params.rotationList.filter((id) => eligibleIds.has(id));
    if (rotation.length === 0) rotation = buildRotationList(eligible);
  } else {
    rotation = buildRotationList(eligible);
  }
  if (rotation.length === 0) {
    return { agentId: null, newQueuePointer: queuePointer, distanceMiles: null, usedProximity: false };
  }

  const usedProximity = proximityPool.size > 0;
  // Step 4: stop only at proximity-pool agents. Step 5: no filter (all eligible).
  const isEligibleAtStop = (agentId: number): boolean =>
    usedProximity ? proximityPool.has(agentId) : true;

  const start = ((queuePointer % rotation.length) + rotation.length) % rotation.length;
  for (let offset = 0; offset < rotation.length; offset++) {
    const idx = (start + offset) % rotation.length;
    const candidateId = rotation[idx];
    if (isEligibleAtStop(candidateId)) {
      // Step 6: advance pointer past the selected slot.
      const newQueuePointer = (idx + 1) % rotation.length;
      return {
        agentId: candidateId,
        newQueuePointer,
        distanceMiles: distanceById.get(candidateId) ?? null,
        usedProximity,
      };
    }
  }

  // Should be unreachable (when !usedProximity every slot qualifies), but stay safe:
  return { agentId: null, newQueuePointer: queuePointer, distanceMiles: null, usedProximity };
}
