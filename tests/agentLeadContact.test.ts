import { describe, it, expect } from 'vitest';
import { agentLeadContactSchema } from '../lib/validation';

describe('agentLeadContactSchema (agent-editable lead contact)', () => {
  const base = { leadOfferId: 5, firstName: 'Jane', email: 'jane@example.com' };

  it('accepts a valid full contact', () => {
    const r = agentLeadContactSchema.safeParse({
      ...base,
      lastName: "O'Brien",
      phone: '(555) 123-4567',
    });
    expect(r.success).toBe(true);
  });

  it('accepts blank/omitted last name and phone', () => {
    expect(agentLeadContactSchema.safeParse(base).success).toBe(true);
    expect(
      agentLeadContactSchema.safeParse({ ...base, lastName: '', phone: '' }).success,
    ).toBe(true);
  });

  it('requires a first name', () => {
    expect(agentLeadContactSchema.safeParse({ ...base, firstName: '' }).success).toBe(false);
    expect(agentLeadContactSchema.safeParse({ ...base, firstName: '   ' }).success).toBe(false);
  });

  it('rejects names containing digits', () => {
    expect(agentLeadContactSchema.safeParse({ ...base, firstName: 'Jane2' }).success).toBe(false);
    expect(
      agentLeadContactSchema.safeParse({ ...base, lastName: 'Smith3' }).success,
    ).toBe(false);
  });

  it('requires a valid email', () => {
    expect(agentLeadContactSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(agentLeadContactSchema.safeParse({ ...base, email: '' }).success).toBe(false);
  });

  it('requires a positive leadOfferId', () => {
    expect(agentLeadContactSchema.safeParse({ ...base, leadOfferId: 0 }).success).toBe(false);
    expect(agentLeadContactSchema.safeParse({ ...base, leadOfferId: -1 }).success).toBe(false);
  });
});
