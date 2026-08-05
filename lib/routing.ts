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
  /**
   * Whether the agent is currently accepting leads (D7).
   *
   * This is a RUNTIME check, not a membership one. An unavailable agent keeps
   * their slots and their place in the queue; when one of their slots surfaces
   * it is skipped and moved to the BACK. Undefined is treated as available, so
   * callers that don't model availability (the admin rotation preview) behave
   * as before.
   */
  isAvailable?: boolean;
  /**
   * When this agent first opted in — their JOIN ORDER (D7). Used only to order
   * NEW slots appended to the queue, so the line is first-come-first-served.
   * Undefined sorts last among additions, then by id.
   */
  joinedAtMs?: number | null;
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
 * Weave a NEW ENTRANT's slots into an existing line.
 *
 * Their first slot goes in once every agent already in the line has had one
 * turn — so a newcomer waits a lap, not the whole queue — and the remaining
 * slots are spread evenly through what follows rather than clustered.
 *
 * Appending them all at the back instead (the previous behaviour) was doubly
 * wrong: an agent joining a queue of 8 slots waited 8 turns for their first
 * lead and then received three in a row, because the +50 head start buys three
 * slots and all three landed together.
 *
 * Everything before the insertion point is untouched, and the existing ids keep
 * their relative order throughout — a newcomer only ever inserts BETWEEN
 * existing agents, never reorders them.
 */
function weaveEntrant(line: number[], id: number, count: number): number[] {
  if (count <= 0) return line;
  if (line.length === 0) return new Array<number>(count).fill(id);

  // f = the index by which every agent already in the line has appeared once.
  const distinct = new Set(line);
  const seen = new Set<number>();
  let f = line.length;
  for (let i = 0; i < line.length; i++) {
    seen.add(line[i]);
    if (seen.size === distinct.size) {
      f = i + 1;
      break;
    }
  }

  const head = line.slice(0, f);
  const tail = line.slice(f);
  const out = [...head, id];

  // The remaining slots split the tail into (count - 1) near-equal chunks, with
  // one slot after each — evenly spread rather than bunched.
  const chunks = count - 1;
  if (chunks <= 0) return [...out, ...tail];

  let idx = 0;
  for (let c = 0; c < chunks; c++) {
    const size = Math.ceil((tail.length - idx) / (chunks - c));
    out.push(...tail.slice(idx, idx + size), id);
    idx += size;
  }
  return [...out, ...tail.slice(idx)];
}

/**
 * Reconcile an existing queue with the current MEMBER set without rebuilding
 * from scratch — preserving the live order (and move-to-back progress).
 *
 * `members` is every agent who belongs in the queue: active, and opted in at
 * least once. It is NOT filtered by current availability (D7). An agent who has
 * paused keeps their slots and their position; availability is applied later,
 * at send time, by `recommendAgents`. Removing a paused agent's slots here is
 * exactly what let a pause/resume cycle act as a queue reset.
 *
 * Existing slots keep their relative order. Extra slots from a score decrease
 * are dropped (latest occurrences first). Additions are handled in two ways,
 * and the distinction is the point:
 *
 *   NEW ENTRANT (no slots currently in the line) — woven in after every existing
 *     member has had one turn (see `weaveEntrant`). They have never had a turn,
 *     so making them wait the entire queue for their first lead ever is neither
 *     fair to them nor good for the sellers, who would then get three
 *     consecutive leads routed to the newest agent.
 *   SCORE INCREASE (already holds slots) — APPENDED at the back, in join order.
 *     They are already receiving turns, and score is the thing agents can
 *     influence, so a newly earned slot entering at the back is the right
 *     incentive.
 *
 * An agent an admin deactivated and later reactivated loses their slots while
 * off the roster and so returns as an entrant. That is deliberate: `isActive` is
 * admin-controlled, not agent-controlled, so it is not a gaming vector, and a
 * returning agent should not be punished with a full-queue wait.
 *
 * ANTI-GAMING (D7) IS UNAFFECTED. A pause/resume produces no additions at all —
 * `desired` and `kept` are both unchanged, so this returns the identical list.
 * That property comes from `queueJoinedAt` being set once and membership
 * surviving pauses (lib/agentAvailability.ts), not from where additions land.
 */
export function reconcileRotation(current: number[], members: RoutingAgent[]): number[] {
  const desired = new Map<number, number>();
  for (const a of members) desired.set(a.id, slotCountForScore(a.score));

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

  // Join order: earliest joiner first; unknown join time last, then by id for
  // determinism.
  const byJoin = [...members].sort((a, b) => {
    const ja = a.joinedAtMs ?? Number.POSITIVE_INFINITY;
    const jb = b.joinedAtMs ?? Number.POSITIVE_INFINITY;
    return ja - jb || a.id - b.id;
  });

  const entrants: { id: number; count: number }[] = [];
  const growth: number[] = [];
  for (const a of byJoin) {
    const held = keptCount.get(a.id) ?? 0;
    const add = (desired.get(a.id) ?? 0) - held;
    if (add <= 0) continue;
    if (held === 0) entrants.push({ id: a.id, count: add });
    else for (let k = 0; k < add; k++) growth.push(a.id);
  }

  let line = kept;
  for (const e of entrants) line = weaveEntrant(line, e.id, e.count);

  return growth.length > 0 ? [...line, ...growth] : line;
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
  /** The chosen agent, or null when none was assigned (see `outcome`). */
  agentId: number | null;
  /**
   * The queue AFTER this selection: the served slot is moved to the back, and
   * any slots skipped for distance stay at the front. Persist this. Left
   * unchanged when no agent was assigned.
   */
  rotationList: number[];
  /**
   * Distance in miles from the chosen agent to the property, when both have
   * coordinates. On an `outside-area` outcome this is the distance to the
   * NEAREST agent (so the admin can see how far out of range it fell).
   */
  distanceMiles: number | null;
  /** Whether selection came from the proximity pool (false = global fallback). */
  usedProximity: boolean;
  /**
   * Why this result looks the way it does:
   *  - `assigned`      an agent was chosen (proximity or global fallback).
   *  - `no-agents`     there are no eligible agents at all (empty roster / all
   *                    excluded on reassignment).
   *  - `outside-area`  the lead has coordinates and at least one agent is
   *                    geocoded, but the lead is outside EVERY geocoded agent's
   *                    service radius — deliberately left UNASSIGNED (no global
   *                    fallback) so the admin handles it directly.
   */
  outcome: 'assigned' | 'no-agents' | 'outside-area';
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
    return { agentId: null, rotationList: rotation, distanceMiles: null, usedProximity: false, outcome: 'no-agents' };
  }

  const hasLeadCoords = propertyLat != null && propertyLng != null;

  // Distance map + proximity pool — each agent is in the pool when the lead is
  // within THAT agent's own radius (falling back to the global default). Empty
  // if no lead coords. `anyAgentGeocoded` records whether proximity could even
  // be evaluated (at least one eligible agent has coordinates).
  const distanceById = new Map<number, number>();
  const proximityPool = new Set<number>();
  let anyAgentGeocoded = false;
  if (hasLeadCoords) {
    for (const a of eligible) {
      if (a.lat != null && a.lng != null) {
        anyAgentGeocoded = true;
        const dist = haversine(propertyLat!, propertyLng!, a.lat, a.lng);
        distanceById.set(a.id, dist);
        if (dist <= (a.radiusMiles ?? radiusMiles)) proximityPool.add(a.id);
      }
    }
  }

  // Availability is a SEND-TIME check, not a membership one (D7). An agent who
  // has paused keeps their slots and their position; the skip happens here,
  // when one of their slots actually surfaces.
  //
  // The two skip kinds are deliberately different, and the difference is the
  // whole point:
  //   DISTANCE skip  — the agent did nothing wrong and a lead was never really
  //                    theirs to take, so the slot KEEPS its place at the front
  //                    and they are reconsidered first next time.
  //   UNAVAILABLE    — a lead WOULD have gone to them and they had routing
  //                    switched off, so the slot moves to the BACK. Penalised
  //                    on surface, not on toggle.
  //
  // Because pausing never removes an agent from the queue, and un-pausing never
  // re-inserts them, toggling availability cannot improve a position — the
  // gaming vector is closed by construction rather than by policy.
  const unavailable = new Set(eligible.filter((a) => a.isAvailable === false).map((a) => a.id));
  const skippedUnavailable: number[] = [];
  if (unavailable.size > 0) {
    // Peel unavailable slots off the front until an available one surfaces.
    // Only slots that actually reached the front are penalised.
    while (rotation.length > 0 && unavailable.has(rotation[0])) {
      skippedUnavailable.push(rotation[0]);
      rotation = rotation.slice(1);
    }
    if (rotation.length === 0) {
      // Everyone in the queue is paused. Restore the order (with the skipped
      // slots moved to the back, since each did surface) and report no agent.
      return {
        agentId: null,
        rotationList: skippedUnavailable,
        distanceMiles: null,
        usedProximity: false,
        outcome: 'no-agents',
      };
    }
  }

  // Find the slot to serve: first in-range slot when a pool exists (skipping
  // out-of-range slots), else the front slot. Unavailable agents are excluded
  // from the proximity pool too, so a paused agent deeper in the queue can't be
  // selected just because they happen to be the closest.
  for (const id of unavailable) proximityPool.delete(id);

  let servedIndex = 0;
  let usedProximity = false;
  if (proximityPool.size > 0) {
    const idx = rotation.findIndex((id) => proximityPool.has(id));
    if (idx >= 0) {
      servedIndex = idx;
      usedProximity = true;
    }
  } else if (hasLeadCoords && anyAgentGeocoded) {
    // We COULD evaluate proximity (the lead has coordinates and at least one
    // agent is geocoded) and no agent is within range → the lead is outside
    // every agent's service area. Do NOT fall back to the global queue; leave
    // it unassigned so the admin handles it directly. Report the nearest-agent
    // distance for context.
    const nearest = distanceById.size > 0 ? Math.min(...distanceById.values()) : null;
    return {
      agentId: null,
      rotationList: [...rotation, ...skippedUnavailable],
      distanceMiles: nearest,
      usedProximity: false,
      outcome: 'outside-area',
    };
  }
  // Otherwise (no lead coordinates, or no agent is geocoded) proximity cannot be
  // evaluated at all, so we keep the global-queue fallback rather than sending
  // every lead to the admin.

  const agentId = rotation[servedIndex];

  // Move the served slot to the back; distance-skipped (front) slots keep their
  // place, and any unavailable slots that surfaced go to the back behind it.
  const newRotation = rotation.slice();
  newRotation.splice(servedIndex, 1);
  newRotation.push(agentId, ...skippedUnavailable);

  return {
    agentId,
    rotationList: newRotation,
    distanceMiles: distanceById.get(agentId) ?? null,
    usedProximity,
    outcome: 'assigned',
  };
}
