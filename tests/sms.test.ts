import { describe, it, expect } from 'vitest';
import { toE164, buildTelnyxPayload } from '../lib/sms';

describe('toE164', () => {
  it('normalizes 10-digit US', () => expect(toE164('810-555-0134')).toBe('+18105550134'));
  it('keeps E.164', () => expect(toE164('+18105550134')).toBe('+18105550134'));
  it('rejects junk', () => expect(toE164('abc')).toBeNull());
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
