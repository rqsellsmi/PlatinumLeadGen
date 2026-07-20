import { describe, it, expect } from 'vitest';
import { shouldSendAgentSms } from '../lib/agentSms';

describe('shouldSendAgentSms', () => {
  it('true for opted-in agent with a phone', () => {
    expect(shouldSendAgentSms({ smsOptOut: false, phone: '+18105550134' })).toBe(true);
  });
  it('false when opted out', () => {
    expect(shouldSendAgentSms({ smsOptOut: true, phone: '+18105550134' })).toBe(false);
  });
  it('false when no phone', () => {
    expect(shouldSendAgentSms({ smsOptOut: false, phone: null })).toBe(false);
  });
});
