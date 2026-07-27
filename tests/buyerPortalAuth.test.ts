import { describe, it, expect, beforeAll } from 'vitest';
import {
  createBuyerSession,
  verifyBuyerSession,
  verifyBuyerSessionEdge,
  generateMagicToken,
  hashToken,
  magicTokenExpiry,
  isExpired,
} from '../lib/buyerPortalAuth';

const SECRET = 'test-buyer-secret-please-change';

beforeAll(() => {
  process.env.BUYER_SESSION_SECRET = SECRET;
});

describe('buyer session cookie', () => {
  it('round-trips a buyer id', () => {
    const { value } = createBuyerSession(42);
    expect(verifyBuyerSession(value)).toBe(42);
  });

  it('rejects a tampered signature', () => {
    const { value } = createBuyerSession(42);
    const parts = value.split('.');
    parts[2] = parts[2].replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    expect(verifyBuyerSession(parts.join('.'))).toBeNull();
  });

  it('rejects a tampered id (signature no longer matches)', () => {
    const { value } = createBuyerSession(42);
    const parts = value.split('.');
    parts[0] = '99';
    expect(verifyBuyerSession(parts.join('.'))).toBeNull();
  });

  it('rejects an expired session', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    const { value } = createBuyerSession(42, old);
    expect(verifyBuyerSession(value)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyBuyerSession(undefined)).toBeNull();
    expect(verifyBuyerSession('nope')).toBeNull();
    expect(verifyBuyerSession('a.b')).toBeNull();
  });

  it('edge verifier matches the node verifier', async () => {
    const { value } = createBuyerSession(7);
    expect(await verifyBuyerSessionEdge(value, SECRET)).toBe(7);
    // wrong secret → null
    expect(await verifyBuyerSessionEdge(value, 'other-secret')).toBeNull();
  });
});

describe('magic-link tokens', () => {
  it('generates a 64-char hex token', () => {
    const t = generateMagicToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it('hashes deterministically and differs per token', () => {
    const a = generateMagicToken();
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(generateMagicToken()));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('expiry is ~30 min out and isExpired works', () => {
    const exp = magicTokenExpiry();
    expect(exp.getTime()).toBeGreaterThan(Date.now());
    expect(isExpired(exp)).toBe(false);
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(null)).toBe(true);
  });
});
