import { describe, it, expect } from 'vitest';
import {
  haversine,
  slotCountForScore,
  buildRotationList,
  reconcileRotation,
  recommendAgents,
  type RoutingAgent,
} from '../lib/routing';

describe('haversine', () => {
  it('returns ~0 for identical points', () => {
    expect(haversine(42.5, -83.7, 42.5, -83.7)).toBeCloseTo(0, 5);
  });
  it('computes a known distance (Brighton -> Ann Arbor ~ 18mi)', () => {
    const d = haversine(42.5295, -83.7799, 42.2808, -83.743);
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(22);
  });
});

describe('slotCountForScore', () => {
  it('floors at 1 for zero/negative score', () => {
    expect(slotCountForScore(0)).toBe(1);
    expect(slotCountForScore(-50)).toBe(1);
  });
  it('increases with score and caps at 5', () => {
    expect(slotCountForScore(15)).toBe(2);
    expect(slotCountForScore(45)).toBe(4);
    expect(slotCountForScore(1000)).toBe(5);
  });
});

describe('buildRotationList', () => {
  it('gives each agent slotCount slots, interleaved (not clustered)', () => {
    const agents: RoutingAgent[] = [
      { id: 2, lat: 0, lng: 0, score: 0 }, // 1 slot
      { id: 1, lat: 0, lng: 0, score: 30 }, // 3 slots
    ];
    // Agent 2's single slot lands in the middle, not appended at the end.
    expect(buildRotationList(agents)).toEqual([1, 1, 2, 1]);
  });

  it('spaces a newly-activated agent through the queue, not at the end', () => {
    const agents: RoutingAgent[] = [
      { id: 1, lat: 0, lng: 0, score: 60 }, // 5 slots (veteran)
      { id: 2, lat: 0, lng: 0, score: 0 }, // 1 slot (new agent)
    ];
    const list = buildRotationList(agents);
    expect(list.filter((id) => id === 1)).toHaveLength(5);
    expect(list.filter((id) => id === 2)).toHaveLength(1);
    // The new agent is woven in, not stuck at the front or the very end.
    const pos = list.indexOf(2);
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(list.length - 1);
  });
});

describe('reconcileRotation', () => {
  const A = (id: number, score: number): RoutingAgent => ({ id, lat: 0, lng: 0, score });

  it('no change returns the same order', () => {
    const current = [1, 1, 2, 1];
    const available = [A(1, 30), A(2, 0)]; // 3 and 1 slots
    expect(reconcileRotation(current, available)).toEqual(current);
  });

  it('preserves the live order and weaves a new agent in (not at the end)', () => {
    // Mid-cycle queue for agent 1 (3 slots) after some move-to-back churn.
    const current = [1, 1, 1];
    const available = [A(1, 30), A(2, 0)]; // agent 2 is newly activated (1 slot)
    const next = reconcileRotation(current, available);
    // Agent 1's three slots stay in order; agent 2 appears once, not appended last.
    expect(next.filter((id) => id === 1)).toEqual([1, 1, 1]);
    expect(next.filter((id) => id === 2)).toHaveLength(1);
    expect(next[next.length - 1]).toBe(1); // woven in, not stuck at the very end
  });

  it('drops slots for an agent who is no longer available', () => {
    const current = [1, 2, 1, 2];
    const available = [A(1, 15)]; // agent 2 gone; agent 1 keeps 2 slots
    expect(reconcileRotation(current, available)).toEqual([1, 1]);
  });

  it('drops extra slots when a score decreases (keeps the earliest)', () => {
    const current = [1, 1, 1, 2];
    const available = [A(1, 0), A(2, 0)]; // agent 1 now 1 slot
    const next = reconcileRotation(current, available);
    expect(next.filter((id) => id === 1)).toHaveLength(1);
    expect(next.filter((id) => id === 2)).toHaveLength(1);
  });
});

describe('recommendAgents', () => {
  const near: RoutingAgent = { id: 1, lat: 42.53, lng: -83.78, score: 0 }; // ~Brighton
  const far: RoutingAgent = { id: 2, lat: 42.33, lng: -83.05, score: 0 }; // ~Dearborn, far

  it('proximity match: selects a nearby agent within radius', () => {
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 20,
    });
    expect(r.agentId).toBe(1);
    expect(r.usedProximity).toBe(true);
    expect(r.distanceMiles).toBeLessThan(5);
  });

  it('Dearborn bug: never offers to the far agent when a near one qualifies', () => {
    // Queue has the far agent at the FRONT; proximity-first must skip it.
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 20,
      rotationList: [2, 1], // far agent first
    });
    expect(r.agentId).toBe(1);
  });

  it('distance skip keeps the skipped agent at the front and moves the served slot to the back', () => {
    // Far agent (2) is at the front but out of range; near agent (1) is served.
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 20,
      rotationList: [2, 1],
    });
    expect(r.agentId).toBe(1);
    // 2 stays at the front (reconsidered first next lead); 1's slot went to back.
    expect(r.rotationList).toEqual([2, 1]);
    expect(r.rotationList[0]).toBe(2);
  });

  it('served slot moves to the back on a normal (front, in-range) pick', () => {
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 200, // both in range
      rotationList: [1, 2],
    });
    expect(r.agentId).toBe(1);
    expect(r.rotationList).toEqual([2, 1]); // 1 served -> moved to back
  });

  it('per-agent radius: an own radius smaller than the distance drops the proximity match', () => {
    const r = recommendAgents({
      agents: [{ ...far, radiusMiles: 10 }], // ~35mi away but only willing to go 10
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 100, // global default would have included them
    });
    expect(r.agentId).toBe(2); // still served via fallback
    expect(r.usedProximity).toBe(false);
  });

  it('per-agent radius: a generous own radius keeps a farther agent in the pool', () => {
    const r = recommendAgents({
      agents: [{ ...far, radiusMiles: 100 }], // ~35mi away, willing to go 100
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 20, // global default would have excluded them
    });
    expect(r.agentId).toBe(2);
    expect(r.usedProximity).toBe(true);
  });

  it('proximity fallback: empty pool -> serves the front slot', () => {
    const r = recommendAgents({
      agents: [far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 5, // far agent is outside -> empty proximity pool
    });
    expect(r.agentId).toBe(2);
    expect(r.usedProximity).toBe(false);
  });

  it('global fallback: lead has no coordinates -> uses all active agents', () => {
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: null,
      propertyLng: null,
      radiusMiles: 20,
    });
    expect(r.agentId).not.toBeNull();
    expect(r.usedProximity).toBe(false);
  });

  it('excluded agent ids are never selected (reassignment)', () => {
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 100, // both in pool
      excludedAgentIds: [1],
    });
    expect(r.agentId).toBe(2);
  });

  it('returns null when all agents are excluded', () => {
    const r = recommendAgents({
      agents: [near],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 20,
      excludedAgentIds: [1],
    });
    expect(r.agentId).toBeNull();
  });
});
