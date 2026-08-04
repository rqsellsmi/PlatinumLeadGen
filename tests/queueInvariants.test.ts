/**
 * Queue-integrity invariants (P0.8b, decision D7 / D7 MODIFIED).
 *
 * D7 MODIFIED requires the new queue to be SIMULATED and property-tested before
 * it is enabled in production, because swapping routing on a live system is the
 * riskiest change in the plan. These are those tests.
 *
 * The invariants are stated as properties over multi-lead simulations rather
 * than as single-step assertions, because the defect they guard against — an
 * agent improving their position by toggling availability — only shows up
 * across a sequence.
 *
 * Everything here exercises the PURE functions (`recommendAgents`,
 * `buildRotationList`, `reconcileRotation`). DB orchestration stays in
 * autoOffer/queue, which is what makes this testable at all (lessons-learned §1).
 */
import { describe, it, expect } from 'vitest';
import {
  recommendAgents,
  buildRotationList,
  reconcileRotation,
  type RoutingAgent,
} from '../lib/routing';

/** An agent with no coordinates → proximity is never evaluated, so the tests
 *  isolate rotation behaviour from distance behaviour. */
const A = (id: number, score = 0, isAvailable = true, joinedAtMs?: number): RoutingAgent => ({
  id,
  lat: null,
  lng: null,
  score,
  isAvailable,
  joinedAtMs,
});

/** Serve `n` leads and return the sequence of agents served + the final queue. */
function simulate(agents: RoutingAgent[], rotation: number[], n: number) {
  const served: (number | null)[] = [];
  let current = rotation;
  for (let i = 0; i < n; i++) {
    const r = recommendAgents({
      agents,
      propertyLat: null,
      propertyLng: null,
      radiusMiles: 20,
      rotationList: current,
    });
    served.push(r.agentId);
    current = r.rotationList;
  }
  return { served, rotation: current };
}

describe('INVARIANT: toggling availability never improves queue position', () => {
  it('a pause/resume cycle does not move an agent forward', () => {
    // The defect this replaces: availability was a MEMBERSHIP filter, so
    // pausing deleted an agent's slots and resuming re-wove them into the
    // middle. An agent at the back could toggle off and on to jump the line.
    const members = [A(1), A(2), A(3)];
    const queue = [1, 2, 3];

    // Agent 3 is last. They pause…
    const paused = [A(1), A(2), A(3, 0, false)];
    const afterPauseReconcile = reconcileRotation(queue, paused);
    // …membership is unchanged, so their slot is still exactly where it was.
    expect(afterPauseReconcile).toEqual([1, 2, 3]);

    // …and they resume.
    const afterResume = reconcileRotation(afterPauseReconcile, members);
    expect(afterResume).toEqual([1, 2, 3]);
  });

  it('an agent cannot skip the line by pausing while others are served', () => {
    const members = [A(1), A(2), A(3)];
    let queue = [1, 2, 3];

    // Agent 3 pauses, two leads are served to 1 and 2.
    const paused = [A(1), A(2), A(3, 0, false)];
    const sim = simulate(paused, queue, 2);
    expect(sim.served).toEqual([1, 2]);
    queue = sim.rotation;

    // Agent 3 resumes. They must be at the FRONT — they waited their turn and
    // never surfaced — not re-inserted anywhere else.
    const resumed = reconcileRotation(queue, members);
    expect(resumed[0]).toBe(3);
  });

  it('a paused agent whose slot SURFACES loses that turn (on-surface penalty)', () => {
    // The distinction that makes the model fair: the penalty applies when a
    // lead would actually have gone to them, not merely because they toggled.
    const agents = [A(1, 0, false), A(2)];
    const r = recommendAgents({
      agents,
      propertyLat: null,
      propertyLng: null,
      radiusMiles: 20,
      rotationList: [1, 2],
    });
    expect(r.agentId).toBe(2);
    // Agent 1's slot surfaced and was skipped → it goes to the BACK.
    expect(r.rotationList).toEqual([2, 1]);
  });

  it('returns no agent when every member is paused, without losing the queue', () => {
    const agents = [A(1, 0, false), A(2, 0, false)];
    const r = recommendAgents({
      agents,
      propertyLat: null,
      propertyLng: null,
      radiusMiles: 20,
      rotationList: [1, 2],
    });
    expect(r.agentId).toBeNull();
    expect(r.outcome).toBe('no-agents');
    // Both surfaced, so both moved to the back — but nothing is lost.
    expect([...r.rotationList].sort()).toEqual([1, 2]);
  });
});

describe('INVARIANT: a served slot moves to the back', () => {
  it('holds over a long simulation', () => {
    const agents = [A(1), A(2), A(3)];
    const { served } = simulate(agents, [1, 2, 3], 9);
    expect(served).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
  });

  it('distributes proportionally to slot count', () => {
    // Agent 1 has 3 slots (score 40), agent 2 has 1 (score 0).
    const agents = [A(1, 40), A(2, 0)];
    const rotation = buildRotationList(agents);
    const { served } = simulate(agents, rotation, 12);
    expect(served.filter((id) => id === 1)).toHaveLength(9);
    expect(served.filter((id) => id === 2)).toHaveLength(3);
  });
});

describe('INVARIANT: an existing agent position is stable when others change', () => {
  it('the top slot does not move when a new agent joins', () => {
    const queue = [1, 2, 1];
    const withNewcomer = reconcileRotation(queue, [A(1, 40), A(2), A(3, 0, true, 999)]);
    expect(withNewcomer[0]).toBe(1);
    expect(withNewcomer.slice(0, queue.length)).toEqual(queue);
  });

  it('the top slot does not move when another agent gains a slot', () => {
    const queue = [1, 2];
    // Agent 2's score rises from 0 to 40 → 3 slots (2 additions).
    const next = reconcileRotation(queue, [A(1), A(2, 40)]);
    expect(next.slice(0, 2)).toEqual([1, 2]);
    expect(next.filter((id) => id === 2)).toHaveLength(3);
  });

  it('a score decrease drops the LATEST slots, keeping earned position', () => {
    const queue = [1, 1, 1, 2];
    const next = reconcileRotation(queue, [A(1, 0), A(2, 0)]);
    expect(next[0]).toBe(1);
    expect(next.filter((id) => id === 1)).toHaveLength(1);
  });
});

describe('INVARIANT: reconcileRotation is idempotent and conserves slots', () => {
  it('running it twice changes nothing the second time', () => {
    const members = [A(1, 40), A(2, 10), A(3, 0, true, 5)];
    const once = reconcileRotation([1, 2, 1], members);
    const twice = reconcileRotation(once, members);
    expect(twice).toEqual(once);
  });

  it('the slot count always equals the sum of desired slots', () => {
    const members = [A(1, 40), A(2, 10), A(3, 0)];
    // slotCountForScore: 40 -> 3, 10 -> 2, 0 -> 1  => 6 total
    for (const start of [[], [1], [1, 2, 3], [3, 3, 3, 3, 3], [9, 9]]) {
      expect(reconcileRotation(start, members)).toHaveLength(6);
    }
  });

  it('never invents an id that is not a member', () => {
    const members = [A(1), A(2)];
    const next = reconcileRotation([1, 2, 99, 99], members);
    expect(next).not.toContain(99);
  });
});

describe('INVARIANT: membership is unaffected by availability', () => {
  it('a paused member keeps every slot their score earns', () => {
    const members = [A(1, 40, false), A(2, 0, true)];
    const next = reconcileRotation([], members);
    expect(next.filter((id) => id === 1)).toHaveLength(3);
  });

  it('reconciling produces the same queue whether or not an agent is paused', () => {
    const active = [A(1, 40), A(2, 10)];
    const paused = [A(1, 40, false), A(2, 10, false)];
    expect(reconcileRotation([1, 2], paused)).toEqual(reconcileRotation([1, 2], active));
  });
});

describe('regression: availability interacts correctly with distance', () => {
  it('a paused agent is not selected even when they are the closest', () => {
    const near = { id: 1, lat: 42.53, lng: -83.78, score: 0, isAvailable: false };
    const far = { id: 2, lat: 42.28, lng: -83.74, score: 0, isAvailable: true };
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.53,
      propertyLng: -83.78,
      radiusMiles: 50,
      rotationList: [1, 2],
    });
    expect(r.agentId).toBe(2);
  });

  it('a distance skip still keeps its place while an availability skip does not', () => {
    // Agent 1: available but out of range → skipped for DISTANCE, stays front.
    // Agent 2: in range, available → served, moves to back.
    const out = { id: 1, lat: 45.0, lng: -84.0, score: 0, isAvailable: true };
    const near = { id: 2, lat: 42.53, lng: -83.78, score: 0, isAvailable: true };
    const r = recommendAgents({
      agents: [out, near],
      propertyLat: 42.53,
      propertyLng: -83.78,
      radiusMiles: 25,
      rotationList: [1, 2],
    });
    expect(r.agentId).toBe(2);
    expect(r.rotationList[0]).toBe(1); // distance skip kept its turn
  });
});
