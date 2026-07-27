import { describe, it, expect } from 'vitest';
import { sumHeldByAgent } from '../lib/referral';

describe('sumHeldByAgent', () => {
  it('nets held deltas per agent', () => {
    const rows = [
      { agentId: 1, delta: 2 },
      { agentId: 1, delta: 10 },
      { agentId: 2, delta: 4 },
      { agentId: 1, delta: -1 },
    ];
    const byAgent = sumHeldByAgent(rows);
    expect(byAgent.get(1)).toBe(11); // 2 + 10 - 1
    expect(byAgent.get(2)).toBe(4);
    expect(byAgent.size).toBe(2);
  });

  it('is empty for no held rows', () => {
    expect(sumHeldByAgent([]).size).toBe(0);
  });
});
