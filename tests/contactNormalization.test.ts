import { describe, it, expect } from 'vitest';
import {
  normalizedEmailKey,
  normalizedPhoneKey,
  sameEmailIdentity,
} from '../lib/contactNormalization';

describe('normalizedEmailKey', () => {
  it('lower-cases and trims', () => {
    expect(normalizedEmailKey('  Jane@Example.COM ')).toBe('jane@example.com');
  });
  it('returns null for empty/whitespace/nullish', () => {
    expect(normalizedEmailKey('')).toBeNull();
    expect(normalizedEmailKey('   ')).toBeNull();
    expect(normalizedEmailKey(null)).toBeNull();
    expect(normalizedEmailKey(undefined)).toBeNull();
  });
});

describe('normalizedPhoneKey', () => {
  it('strips non-digits', () => {
    expect(normalizedPhoneKey('(810) 555-0134')).toBe('8105550134');
    expect(normalizedPhoneKey('810.555.0134')).toBe('8105550134');
  });
  it('returns null below the 7-digit floor so noise never matches', () => {
    expect(normalizedPhoneKey('123')).toBeNull();
    expect(normalizedPhoneKey('')).toBeNull();
    expect(normalizedPhoneKey(null)).toBeNull();
  });
});

describe('sameEmailIdentity — email is the identity key (D3)', () => {
  it('true only when both carry an email that matches once normalized', () => {
    expect(sameEmailIdentity('A@b.com', 'a@B.com')).toBe(true);
  });
  it('false when the emails differ', () => {
    expect(sameEmailIdentity('a@b.com', 'c@d.com')).toBe(false);
  });
  it('false when either side has no email — two blanks are NOT the same person', () => {
    expect(sameEmailIdentity(null, null)).toBe(false);
    expect(sameEmailIdentity('a@b.com', null)).toBe(false);
    expect(sameEmailIdentity('', 'a@b.com')).toBe(false);
  });
});
