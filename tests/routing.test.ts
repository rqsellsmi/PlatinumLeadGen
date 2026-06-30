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
  it('repeats each agent by slot count, sorted by id', () => {
    const agents: RoutingAgent[] = [
      { id: 2, lat: 0, lng: 0, score: 0 }, // 1 slot
      { id: 1, lat: 0, lng: 0, score: 30 }, // 3 slots
    ];
    expect(buildRotationList(agents)).toEqual([1, 1, 1, 2]);
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
      queuePointer: 0,
    });
    expect(r.agentId).toBe(1);
    expect(r.usedProximity).toBe(true);
    expect(r.distanceMiles).toBeLessThan(5);
  });

  it('Dearborn bug: never offers to the far agent when a near one qualifies', () => {
    // Pointer starts at the far agent's slot, but proximity-first must skip it.
    const r = recommendAgents({
      agents: [near, far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 20,
      queuePointer: 1, // would land on agent 2 in a naive walk
    });
    expect(r.agentId).toBe(1);
  });

  it('proximity fallback: empty pool -> uses full queue', () => {
    const r = recommendAgents({
      agents: [far],
      propertyLat: 42.5295,
      propertyLng: -83.7799,
      radiusMiles: 5, // far agent is outside -> empty proximity pool
      queuePointer: 0,
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
      queuePointer: 0,
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
      queuePointer: 0,
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
      queuePointer: 0,
      excludedAgentIds: [1],
    });
    expect(r.agentId).toBeNull();
  });
});
