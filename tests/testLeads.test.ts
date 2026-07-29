/**
 * Prod smoke-test suppression (review #68, decision D20/D23 MODIFIED).
 *
 * The point of these tests is the FALSE cases: a flag that accidentally catches
 * a real prospect silently drops that lead out of routing, scoring and the Ads
 * export, which is worse than not having the flag at all.
 */
import { describe, it, expect } from 'vitest';
import {
  configuredTestDomains,
  isReservedTestEmail,
  isReservedTestPhone,
  isTestContact,
} from '../lib/testLeads';

describe('configuredTestDomains', () => {
  it('always includes the built-in reserved domains', () => {
    expect(configuredTestDomains()).toContain('example.com');
  });

  it('merges configured domains, normalising case and a leading @', () => {
    const d = configuredTestDomains('@QA.remaxplatinum.email, staging.test ');
    expect(d).toContain('qa.remaxplatinum.email');
    expect(d).toContain('staging.test');
  });

  it('treats an unset and an empty value identically', () => {
    // An unset GitHub Actions secret arrives as '' (lessons-learned §12d).
    expect(configuredTestDomains('')).toEqual(configuredTestDomains(undefined));
    expect(configuredTestDomains(null)).toEqual(configuredTestDomains(undefined));
  });

  it('does not produce empty entries from stray commas', () => {
    expect(configuredTestDomains(',, ,')).not.toContain('');
  });
});

describe('isReservedTestEmail', () => {
  const domains = configuredTestDomains('qa.remaxplatinum.email');

  it('matches the reserved domain and its subdomains', () => {
    expect(isReservedTestEmail('rq@example.com', domains)).toBe(true);
    expect(isReservedTestEmail('rq@qa.remaxplatinum.email', domains)).toBe(true);
    expect(isReservedTestEmail('rq@mail.qa.remaxplatinum.email', domains)).toBe(true);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(isReservedTestEmail('  RQ@Example.COM ', domains)).toBe(true);
  });

  it('does NOT match a real prospect', () => {
    expect(isReservedTestEmail('seller@gmail.com', domains)).toBe(false);
    expect(isReservedTestEmail('rq@remaxplatinum.email', domains)).toBe(false);
  });

  it('does not match a domain that merely ends with the same letters', () => {
    // notexample.com must not be caught by an endsWith on "example.com".
    expect(isReservedTestEmail('rq@notexample.com', domains)).toBe(false);
  });

  it('handles junk input without matching', () => {
    expect(isReservedTestEmail(null, domains)).toBe(false);
    expect(isReservedTestEmail('', domains)).toBe(false);
    expect(isReservedTestEmail('no-at-sign', domains)).toBe(false);
    expect(isReservedTestEmail('trailing@', domains)).toBe(false);
  });
});

describe('isReservedTestPhone — the 555-01xx fiction block', () => {
  it('matches with and without formatting or country code', () => {
    expect(isReservedTestPhone('810-555-0134')).toBe(true);
    expect(isReservedTestPhone('(810) 555-0100')).toBe(true);
    expect(isReservedTestPhone('8105550199')).toBe(true);
    expect(isReservedTestPhone('+1 810 555 0150')).toBe(true);
  });

  it('does NOT match a real 555 number outside the 01xx block', () => {
    // 555-1234 is an ordinary assignable number; only 555-0100..0199 is reserved.
    expect(isReservedTestPhone('810-555-1234')).toBe(false);
    expect(isReservedTestPhone('810-555-0234')).toBe(false);
  });

  it('does NOT match an ordinary prospect number', () => {
    expect(isReservedTestPhone('810-227-4600')).toBe(false);
    expect(isReservedTestPhone('734-741-1000')).toBe(false);
  });

  it('rejects wrong-length and junk input', () => {
    expect(isReservedTestPhone('5550134')).toBe(false);
    expect(isReservedTestPhone('')).toBe(false);
    expect(isReservedTestPhone(null)).toBe(false);
    expect(isReservedTestPhone('not a phone')).toBe(false);
  });
});

describe('isTestContact', () => {
  const domains = configuredTestDomains();

  it('flags on either signal alone', () => {
    expect(isTestContact({ email: 'rq@example.com', phone: '810-227-4600' }, domains)).toBe(true);
    expect(isTestContact({ email: 'seller@gmail.com', phone: '810-555-0134' }, domains)).toBe(true);
  });

  it('leaves a real prospect alone', () => {
    expect(isTestContact({ email: 'seller@gmail.com', phone: '810-227-4600' }, domains)).toBe(false);
  });

  it('leaves a contact-less partial alone', () => {
    expect(isTestContact({ email: null, phone: null }, domains)).toBe(false);
    expect(isTestContact({}, domains)).toBe(false);
  });
});
