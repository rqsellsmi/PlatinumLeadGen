import { describe, it, expect } from 'vitest';
import { isWithinOfferWindow, etHour } from '../lib/offerWindow';

describe('offer window', () => {
  it('noon ET is inside the window', () => {
    // 2025-06-15 16:00 UTC == 12:00 EDT
    const noonEt = new Date('2025-06-15T16:00:00Z');
    expect(isWithinOfferWindow(noonEt)).toBe(true);
  });

  it('11pm ET is outside the window', () => {
    // 2025-06-16 03:00 UTC == 23:00 EDT (previous day)
    const lateEt = new Date('2025-06-16T03:00:00Z');
    expect(isWithinOfferWindow(lateEt)).toBe(false);
  });

  it('etHour reflects America/New_York', () => {
    const noonEt = new Date('2025-06-15T16:00:00Z');
    expect(etHour(noonEt)).toBe(12);
  });
});
