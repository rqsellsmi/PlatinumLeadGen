import { describe, it, expect } from 'vitest';
import { toE164, buildTelnyxPayload } from '../lib/sms';

describe('toE164', () => {
  it('normalizes 10-digit US', () => expect(toE164('810-555-0134')).toBe('+18105550134'));
  it('keeps E.164', () => expect(toE164('+18105550134')).toBe('+18105550134'));
  it('rejects junk', () => expect(toE164('abc')).toBeNull());
  // Regression: a from-number stored with dashes (e.g. TELNYX_DEFAULT_FROM =
  // "+1-810-355-4099") must collapse to clean E.164, else Telnyx rejects the
  // send with error 40013 "invalid messaging source number".
  it('strips separators from a +1 dashed number', () =>
    expect(toE164('+1-810-355-4099')).toBe('+18103554099'));
  it('strips parens/spaces from a formatted number', () =>
    expect(toE164('(810) 355 4099')).toBe('+18103554099'));
});

describe('buildTelnyxPayload', () => {
  it('builds from/to/text', () => {
    expect(buildTelnyxPayload('+15550001111', '+18105550134', 'hi')).toMatchObject({
      from: '+15550001111', to: '+18105550134', text: 'hi',
    });
  });
  it('adds messaging_profile_id when env set', () => {
    process.env.TELNYX_MESSAGING_PROFILE_ID = 'MP123';
    expect(buildTelnyxPayload('+1', '+2', 'x').messaging_profile_id).toBe('MP123');
    delete process.env.TELNYX_MESSAGING_PROFILE_ID;
  });
});
