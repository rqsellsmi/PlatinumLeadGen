import { describe, it, expect } from 'vitest';
import { offerText, clientInfoText, updateReminderText, helpText, optOutAckText } from '../lib/smsTemplates';

describe('offerText', () => {
  it('includes code + city + estimate, no client name; plain YES/NO (no number)', () => {
    const t = offerText({ leadId: 5739, city: 'Brighton', estimate: 412000, deadline: '4:12pm' });
    expect(t).toContain('#5739');
    expect(t).toContain('Brighton');
    expect(t).toContain('$412k');
    expect(t).toContain('Reply YES to accept');
    expect(t).toContain('NO to pass');
    // Accept/decline no longer instructs a lead number.
    expect(t).not.toContain('YES 5739');
    expect(t).not.toContain('NO 5739');
  });
  it('falls back to the property address when city is empty', () => {
    const t = offerText({
      leadId: 7,
      city: null,
      address: '123 Main St, Brighton, MI 48116',
      estimate: 462000,
      deadline: '1:25pm',
    });
    expect(t).toContain('123 Main St, Brighton, MI 48116');
    expect(t).toContain('$462k');
  });
  it('prefers city over address when both are present', () => {
    const t = offerText({ leadId: 8, city: 'Fenton', address: '9 Oak Ln, Fenton, MI', estimate: null, deadline: '5pm' });
    expect(t).toContain('in Fenton');
    expect(t).not.toContain('9 Oak Ln');
  });
  it('omits estimate when null', () => {
    const t = offerText({ leadId: 1, city: 'Fenton', estimate: null, deadline: '5pm' });
    expect(t).not.toContain('$');
  });
  it('omits location when city and address are both null', () => {
    const t = offerText({ leadId: 42, city: null, address: null, estimate: 300000, deadline: '6pm' });
    expect(t).toContain('#42');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('in .');
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
