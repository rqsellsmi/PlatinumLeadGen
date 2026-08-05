import { describe, it, expect } from 'vitest';
import { offerText, clientInfoText, updateReminderText, helpText, optOutAckText } from '../lib/smsTemplates';

describe('offerText', () => {
  const OFFER = {
    leadId: 5739,
    firstName: 'Sarah',
    city: 'Brighton',
    estimate: 412000,
    timeframe: '3-6 months',
    deadline: '4:12pm',
  };

  it('carries first name, city, estimate, timeframe and deadline', () => {
    const t = offerText(OFFER);
    expect(t).toContain('#5739');
    expect(t).toContain('Sarah');
    expect(t).toContain('in Brighton');
    expect(t).toContain('$412k');
    expect(t).toContain('3-6 months');
    expect(t).toContain('4:12pm');
    expect(t).toContain('Reply YES to accept');
    expect(t).toContain('NO to pass');
    // Accept/decline no longer instructs a lead number.
    expect(t).not.toContain('YES 5739');
    expect(t).not.toContain('NO 5739');
  });

  /**
   * The offer goes out BEFORE the agent has taken the lead, so it must not let
   * anyone contact the seller or find their house. This used to fall back to the
   * full street address whenever city was empty.
   */
  it('has no way to express a street address', () => {
    // The parameter is gone, so a caller cannot pass one even by mistake.
    expect(Object.keys(OFFER)).not.toContain('address');
    const t = offerText({ ...OFFER, city: null });
    expect(t).not.toMatch(/\d+\s+\w+\s+(St|Ave|Rd|Ln|Dr|Blvd|Ct|Way)\b/i);
  });

  it('omits location entirely rather than substituting anything else', () => {
    const t = offerText({ ...OFFER, city: null, firstName: null });
    expect(t).toContain('#5739');
    expect(t).not.toContain('in ');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
  });

  it('omits estimate and timeframe when absent', () => {
    const t = offerText({ ...OFFER, estimate: null, timeframe: null });
    expect(t).not.toContain('$');
    expect(t).not.toContain('Timeframe');
    expect(t).toContain('in Brighton');
  });

  /**
   * A single non-GSM-7 character (em dash, curly quote) flips the whole message
   * to UCS-2, cutting the segment budget from 160 characters to 70.
   */
  it('stays inside the GSM-7 character set', () => {
    const t = offerText(OFFER);
    expect(t).toMatch(/^[\x20-\x7E]+$/);
  });
});

describe('clientInfoText', () => {
  it('includes name, phone, email, address', () => {
    const t = clientInfoText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', phone: '+18105550134', email: 'jane@x.com', address: '123 Main St', city: 'Brighton', estimate: 412000 });
    expect(t).toContain('#5739');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('+18105550134');
    expect(t).toContain('jane@x.com');
    expect(t).toContain('123 Main St');
  });
  it('omits empty fields cleanly', () => {
    const t = clientInfoText({ leadId: 2, firstName: 'Sam', lastName: null, phone: null, email: null, address: null, city: null, estimate: null });
    expect(t).toContain('Sam');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
  });
  it('includes the lead URL when provided, before the reply hint', () => {
    const t = clientInfoText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', phone: null, email: null, address: null, city: null, estimate: null, leadUrl: 'https://remax-platinumonline.com/agent/leads/17' });
    expect(t).toContain('View: https://remax-platinumonline.com/agent/leads/17');
    expect(t.indexOf('View:')).toBeLessThan(t.indexOf('Reply CONNECTED'));
  });
  it('omits the lead URL cleanly when not provided', () => {
    const t = clientInfoText({ leadId: 2, firstName: 'Sam', lastName: null, phone: null, email: null, address: null, city: null, estimate: null });
    expect(t).not.toContain('View:');
  });
});

describe('updateReminderText', () => {
  it('names the lead and asks for a status update', () => {
    const t = updateReminderText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', address: '123 Main St' });
    expect(t).toContain('#5739');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('123 Main St');
  });
  it('handles null name and address gracefully', () => {
    const t = updateReminderText({ leadId: 999, firstName: null, lastName: null, address: null });
    expect(t).toContain('#999');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
  });
  it('includes the lead URL when provided, before the reply hint', () => {
    const t = updateReminderText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', address: '123 Main St', leadUrl: 'https://remax-platinumonline.com/agent/leads/17' });
    expect(t).toContain('View: https://remax-platinumonline.com/agent/leads/17');
    expect(t.indexOf('View:')).toBeLessThan(t.indexOf('Reply e.g.'));
  });
  it('omits the lead URL cleanly when not provided', () => {
    const t = updateReminderText({ leadId: 999, firstName: null, lastName: null, address: null });
    expect(t).not.toContain('View:');
  });
});

describe('helpText', () => {
  it('mentions STOP', () => {
    expect(helpText()).toContain('STOP');
  });
});

describe('optOutAckText', () => {
  it('confirms opt-out and mentions START', () => {
    const t = optOutAckText();
    expect(t).toBeTruthy();
    expect(t).toContain('opted out');
    expect(t).toContain('START');
  });
});
