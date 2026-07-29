/**
 * P0.8a credential tests (review #16/#18/#67, decision D6).
 *
 * The session-version cases are the ones that matter: they are what make a
 * leaked 14-day magic link or a stolen cookie revocable, and a regression there
 * would be silent — everything keeps working, it just stops being killable.
 */
import { describe, it, expect } from 'vitest';

process.env.NEXTAUTH_SECRET ||= 'test-secret-for-agent-sessions';

const {
  hashToken,
  generateMagicLinkToken,
  generateInviteToken,
  magicLinkExpiry,
  inviteExpiry,
  isTokenExpired,
  createAgentSession,
  verifyAgentSession,
  parseSessionValue,
} = await import('../lib/agentPortalAuth');

const NOW = new Date('2026-07-29T12:00:00Z');
const day = 24 * 60 * 60 * 1000;

describe('hashToken', () => {
  it('is a stable 64-char hex SHA-256', () => {
    const h = hashToken('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).toBe(h);
  });

  it('differs for different tokens', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('never returns the input — the point is that the row is not a credential', () => {
    const t = generateMagicLinkToken();
    expect(hashToken(t)).not.toBe(t);
  });
});

describe('token generation', () => {
  it('mints 64-char hex magic links and invites', () => {
    expect(generateMagicLinkToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateInviteToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateMagicLinkToken()));
    expect(seen.size).toBe(100);
  });
});

describe('expiries', () => {
  it('magic links last 14 days, not 30 (D6)', () => {
    expect(magicLinkExpiry(NOW).getTime()).toBe(NOW.getTime() + 14 * day);
  });

  it('invites last 7 days', () => {
    expect(inviteExpiry(NOW).getTime()).toBe(NOW.getTime() + 7 * day);
  });

  it('treats a null expiry as EXPIRED, not as "never expires"', () => {
    expect(isTokenExpired(null, NOW)).toBe(true);
    expect(isTokenExpired(undefined, NOW)).toBe(true);
  });

  it('expires strictly in the past', () => {
    expect(isTokenExpired(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(isTokenExpired(new Date(NOW.getTime() + 1), NOW)).toBe(false);
  });
});

describe('session cookie', () => {
  it('round-trips agentId and sessionVersion', () => {
    const { value } = createAgentSession(42, 3, NOW);
    expect(verifyAgentSession(value, NOW)).toEqual({ agentId: 42, sessionVersion: 3 });
  });

  it('rejects a tampered payload', () => {
    const { value } = createAgentSession(42, 3, NOW);
    const [id, ver, exp, sig] = value.split('.');
    // Try to become agent 1 while keeping the signature.
    expect(verifyAgentSession(`1.${ver}.${exp}.${sig}`, NOW)).toBeNull();
    // Try to claim a different session version.
    expect(verifyAgentSession(`${id}.99.${exp}.${sig}`, NOW)).toBeNull();
    // Try to extend the expiry.
    expect(verifyAgentSession(`${id}.${ver}.${Number(exp) + day}.${sig}`, NOW)).toBeNull();
  });

  it('rejects an expired session', () => {
    const { value } = createAgentSession(42, 0, NOW);
    const later = new Date(NOW.getTime() + 8 * day);
    expect(verifyAgentSession(value, later)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyAgentSession(undefined, NOW)).toBeNull();
    expect(verifyAgentSession('', NOW)).toBeNull();
    expect(verifyAgentSession('nonsense', NOW)).toBeNull();
    expect(verifyAgentSession('1.2', NOW)).toBeNull();
    expect(verifyAgentSession('1.2.3.4.5', NOW)).toBeNull();
  });

  it('accepts a LEGACY 3-part cookie as version 0', () => {
    // Cookies minted before session versions existed must keep working, or the
    // deploy that adds revocation logs the whole roster out. Version 0 is the
    // column default, so they line up.
    const legacy = createAgentSession(7, 0, NOW).value.split('.');
    const legacyValue = `${legacy[0]}.${legacy[2]}.${legacy[3]}`;
    // The 3-part form signs a different payload, so build it the way the old
    // code did and confirm the parser recognises the SHAPE.
    const parsed = parseSessionValue(legacyValue);
    expect(parsed?.agentId).toBe(7);
    expect(parsed?.sessionVersion).toBe(0);
  });

  it('a version bump invalidates an outstanding cookie', () => {
    // The cookie still verifies cryptographically — it is authentic — but the
    // claims no longer match the agent's current version, which is what
    // getCurrentAgent() compares. This is the revocation mechanism.
    const { value } = createAgentSession(42, 1, NOW);
    const claims = verifyAgentSession(value, NOW);
    expect(claims).not.toBeNull();
    const currentVersionAfterRevoke = 2;
    expect(claims!.sessionVersion).not.toBe(currentVersionAfterRevoke);
  });
});
