import { describe, it, expect } from 'vitest';
import { decideBuyerInquiry } from '../lib/buyerInquiry';
import { buyerInquirySchema } from '../lib/validation';

describe('decideBuyerInquiry', () => {
  it('creates a fresh lead when there is no existing buyer lead', () => {
    expect(decideBuyerInquiry(null)).toBe('create');
    expect(decideBuyerInquiry(undefined)).toBe('create');
  });
  it('attaches to an active buyer lead', () => {
    expect(decideBuyerInquiry({ status: 'new' })).toBe('attach');
    expect(decideBuyerInquiry({ status: 'connected' })).toBe('attach');
    expect(decideBuyerInquiry({ status: 'nurturing' })).toBe('attach');
    expect(decideBuyerInquiry({ status: 'signed' })).toBe('attach');
  });
  it('creates a fresh lead when the prior buyer lead is closed or lost', () => {
    expect(decideBuyerInquiry({ status: 'closed' })).toBe('create');
    expect(decideBuyerInquiry({ status: 'lost' })).toBe('create');
  });
});

describe('buyerInquirySchema', () => {
  const base = {
    listingKey: 'RC12345',
    kind: 'showing' as const,
    firstName: 'Dana',
    email: 'dana@example.com',
  };
  it('accepts a valid showing request', () => {
    const r = buyerInquirySchema.safeParse({ ...base, preferredDate: '2026-08-01', preferredTime: 'Morning' });
    expect(r.success).toBe(true);
  });
  it('accepts a contact request without date/time', () => {
    expect(buyerInquirySchema.safeParse({ ...base, kind: 'contact', message: 'Is it still available?' }).success).toBe(true);
  });
  it('requires a valid email', () => {
    expect(buyerInquirySchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
  });
  it('rejects a name with digits', () => {
    expect(buyerInquirySchema.safeParse({ ...base, firstName: 'Dana3' }).success).toBe(false);
  });
  it('rejects an unknown kind', () => {
    expect(buyerInquirySchema.safeParse({ ...base, kind: 'offer' }).success).toBe(false);
  });
  it('requires a listing key', () => {
    expect(buyerInquirySchema.safeParse({ ...base, listingKey: '' }).success).toBe(false);
  });
});
