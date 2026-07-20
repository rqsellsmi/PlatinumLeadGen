import { describe, it, expect } from 'vitest';
import { offerText, clientInfoText, updateReminderText, helpText } from '../lib/smsTemplates';

describe('offerText', () => {
  it('includes code + city + estimate, no client name', () => {
    const t = offerText({ leadId: 5739, city: 'Brighton', estimate: 412000, deadline: '4:12pm' });
    expect(t).toContain('#5739');
    expect(t).toContain('Brighton');
    expect(t).toContain('$412k');
    expect(t).toContain('YES 5739');
    expect(t).toContain('NO 5739');
  });
  it('omits estimate when null', () => {
    const t = offerText({ leadId: 1, city: 'Fenton', estimate: null, deadline: '5pm' });
    expect(t).not.toContain('$');
  });
});

describe('clientInfoText', () => {
  it('includes name, phone, email, address', () => {
    const t = clientInfoText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', phone: '+18105550134', email: 'jane@x.com', address: '123 Main St', city: 'Brighton', estimate: 412000 });
    expect(t).toContain('#5739');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('jane@x.com');
    expect(t).toContain('123 Main St');
  });
  it('omits empty fields cleanly', () => {
    const t = clientInfoText({ leadId: 2, firstName: 'Sam', lastName: null, phone: null, email: null, address: null, city: null, estimate: null });
    expect(t).toContain('Sam');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
  });
});

describe('updateReminderText', () => {
  it('names the lead and asks for a status update', () => {
    const t = updateReminderText({ leadId: 5739, firstName: 'Jane', lastName: 'Doe', address: '123 Main St' });
    expect(t).toContain('#5739');
    expect(t).toContain('Jane Doe');
    expect(t).toContain('123 Main St');
  });
});

describe('helpText', () => {
  it('mentions STOP', () => {
    expect(helpText()).toContain('STOP');
  });
});
