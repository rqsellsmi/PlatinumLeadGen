import { describe, it, expect } from 'vitest';
import {
  haversine,
  slotCountForScore,
  buildRotationList,
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
