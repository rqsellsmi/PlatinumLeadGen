import { describe, it, expect } from 'vitest';
import { isValidPersonName, leadSubmitSchema, INVALID_NAME_MESSAGE } from '../lib/validation';

describe('isValidPersonName (letters, no numbers)', () => {
  it('accepts real names incl. apostrophes, hyphens, accents, suffixes', () => {
    for (const n of ['John', "O'Brien", 'Anne-Marie', 'José', 'Mary Jane', 'Jr.', 'María']) {
      expect(isValidPersonName(n)).toBe(true);
    }
  });

  it('rejects names containing digits', () => {
    for (const n of ['John123', '42', 'J0hn', 'Anne2']) {
      expect(isValidPersonName(n)).toBe(false);
    }
  });

  it('rejects a value with no letters at all', () => {
    expect(isValidPersonName('!!!')).toBe(false);
    expect(isValidPersonName('----')).toBe(false);
  });

  it('treats blank/nullish as "not provided" (presence enforced elsewhere)', () => {
    expect(isValidPersonName('')).toBe(true);
    expect(isValidPersonName('   ')).toBe(true);
    expect(isValidPersonName(null)).toBe(true);
    expect(isValidPersonName(undefined)).toBe(true);
  });

  it('exposes a shared user-facing message', () => {
    expect(INVALID_NAME_MESSAGE).toMatch(/no numbers/i);
  });
});

describe('leadSubmitSchema name validation', () => {
  const base = { sessionId: 's1', email: 'a@b.com' };

  it('rejects a first/last name with digits', () => {
    expect(leadSubmitSchema.safeParse({ ...base, firstName: 'John3' }).success).toBe(false);
    expect(leadSubmitSchema.safeParse({ ...base, lastName: 'Sm1th' }).success).toBe(false);
  });

  it('accepts a valid name and omitted names', () => {
    expect(leadSubmitSchema.safeParse({ ...base, firstName: 'Jane', lastName: "O'Neil" }).success).toBe(true);
    expect(leadSubmitSchema.safeParse(base).success).toBe(true); // names optional
  });
});
