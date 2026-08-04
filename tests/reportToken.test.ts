/**
 * Report-token capability tests (review items #7 / #14, decision D3).
 * Acceptance line from #58: "report tokens are scoped and expire".
 */
import { describe, it, expect } from 'vitest';
import {
  REPORT_TOKEN_TTL_DAYS,
  generateReportToken,
  reportTokenExpiry,
  isReportTokenUsable,
  reportTokensMatch,
} from '../lib/reportToken';

const NOW = new Date('2026-07-29T12:00:00Z');
const day = 24 * 60 * 60 * 1000;

describe('generateReportToken', () => {
  it('is opaque: 32 hex chars, no lead id encoded', () => {
    const t = generateReportToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateReportToken()));
    expect(seen.size).toBe(200);
  });
});

describe('reportTokenExpiry', () => {
  it('expires the configured number of days after issue', () => {
    expect(reportTokenExpiry(NOW).getTime()).toBe(NOW.getTime() + REPORT_TOKEN_TTL_DAYS * day);
  });

  it('honours an explicit TTL', () => {
    expect(reportTokenExpiry(NOW, 1).getTime()).toBe(NOW.getTime() + day);
  });
});

describe('isReportTokenUsable — fails closed', () => {
  const live = { token: 'abc', expiresAt: new Date(NOW.getTime() + day), revokedAt: null };

  it('accepts a live, unrevoked, unexpired token', () => {
    expect(isReportTokenUsable(live, NOW)).toBe(true);
  });

  it('rejects a token with no value', () => {
    expect(isReportTokenUsable({ ...live, token: null }, NOW)).toBe(false);
    expect(isReportTokenUsable({ ...live, token: '' }, NOW)).toBe(false);
  });

  it('rejects an expired token', () => {
    expect(isReportTokenUsable({ ...live, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(false);
  });

  it('rejects a token expiring exactly now (no grace)', () => {
    expect(isReportTokenUsable({ ...live, expiresAt: NOW }, NOW)).toBe(false);
  });

  it('rejects a REVOKED token even while unexpired', () => {
    expect(isReportTokenUsable({ ...live, revokedAt: new Date(NOW.getTime() - day) }, NOW)).toBe(false);
  });

  it('rejects a legacy token with no expiry rather than treating it as eternal', () => {
    // Pre-0033 rows have expires_at NULL. Reading that as "never expires" would
    // silently keep every permanent token alive — the exact defect #14 closes.
    expect(isReportTokenUsable({ token: 'legacy', expiresAt: null, revokedAt: null }, NOW)).toBe(false);
  });
});

describe('reportTokensMatch', () => {
  it('matches identical tokens', () => {
    expect(reportTokensMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects different tokens, different lengths, and nulls', () => {
    expect(reportTokensMatch('abc123', 'abc124')).toBe(false);
    expect(reportTokensMatch('abc', 'abc123')).toBe(false);
    expect(reportTokensMatch(null, 'abc')).toBe(false);
    expect(reportTokensMatch('abc', null)).toBe(false);
    expect(reportTokensMatch(null, null)).toBe(false);
    expect(reportTokensMatch('', '')).toBe(false);
  });
});
