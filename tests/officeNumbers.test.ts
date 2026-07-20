import { describe, it, expect } from 'vitest';
import { pickOfficeNumber } from '../lib/officeNumbers';

describe('pickOfficeNumber', () => {
  const numbers = new Map<number, string | null>([[1, '+15550001111'], [2, null]]);
  it('returns the office number', () => {
    expect(pickOfficeNumber({ officeId: 1, numbersByOfficeId: numbers })).toBe('+15550001111');
  });
  it('falls back to default when office has no number', () => {
    expect(pickOfficeNumber({ officeId: 2, numbersByOfficeId: numbers, defaultNumber: '+15559999999' })).toBe('+15559999999');
  });
  it('falls back to default when agent has no office', () => {
    expect(pickOfficeNumber({ officeId: null, numbersByOfficeId: numbers, defaultNumber: '+15559999999' })).toBe('+15559999999');
  });
  it('returns null when nothing resolves', () => {
    expect(pickOfficeNumber({ officeId: 3, numbersByOfficeId: numbers })).toBeNull();
  });
});
