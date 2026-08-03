import { describe, it, expect } from 'vitest';
import {
  buildValuationPartialBody,
  buildValuationSubmitBody,
  buildGuideLeadBody,
  buildAppointmentBody,
} from '../lib/leadRequests';

/**
 * The client/server wiring gap these tests exist to catch (P0.3):
 *
 * The server's evaluateAbuseSignals reads `company` (honeypot) and
 * `formLoadedAt` (timing) off every public write, but the main funnel forms
 * used to assemble their fetch bodies inline and never sent those fields — so
 * the gate was a no-op. Server-side unit tests prove the evaluator works; they
 * cannot see what the forms actually transmit. These assert the OUTGOING
 * request body each form builds carries the signals, so the gap cannot silently
 * reopen when a form is next edited.
 */

const attribution = { utmSource: 'google', gclid: 'abc', sessionId: 's1' };

describe('lead request bodies carry the abuse signals (P0.3)', () => {
  it('valuation partial sends company + formLoadedAt (and spreads attribution)', () => {
    const body = buildValuationPartialBody({
      sessionId: 'sess',
      propertyAddress: '1 Main St, Brighton, MI',
      propertyLat: 42,
      propertyLng: -83,
      locationSlug: 'brighton',
      pageVariant: 'ads',
      honeypot: '',
      formLoadedAt: 1000,
      attribution,
    });
    expect(body).toHaveProperty('company', '');
    expect(body.formLoadedAt).toBe(1000);
    expect(body.utmSource).toBe('google');
  });

  it('valuation submit forwards a filled honeypot and the timing stamp', () => {
    const body = buildValuationSubmitBody({
      sessionId: 'sess',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '5551234567',
      propertyAddress: '1 Main St, Brighton, MI',
      propertyLat: 42,
      propertyLng: -83,
      locationSlug: '',
      pageVariant: 'seo',
      honeypot: 'ACME Corp',
      formLoadedAt: 2000,
      attribution,
    });
    expect(body.company).toBe('ACME Corp');
    expect(body.formLoadedAt).toBe(2000);
    expect(body.leadType).toBe('valuation');
  });

  it('guide lead (homepage) sends the signals and includes guideId', () => {
    const body = buildGuideLeadBody({
      sessionId: 'sess',
      firstName: 'Jane',
      email: 'jane@example.com',
      locationSlug: '',
      guideId: 7,
      honeypot: '',
      formLoadedAt: 3000,
      attribution,
    });
    expect(body).toHaveProperty('company', '');
    expect(body.formLoadedAt).toBe(3000);
    expect(body.leadType).toBe('seller_guide');
    expect(body).toHaveProperty('guideId', 7);
  });

  it('guide lead (city banner) omits guideId but still sends the signals', () => {
    const body = buildGuideLeadBody({
      sessionId: 'sess',
      firstName: 'Jane',
      email: 'jane@example.com',
      locationSlug: 'brighton',
      honeypot: '',
      formLoadedAt: 3500,
      attribution,
    });
    expect(body).not.toHaveProperty('guideId');
    expect(body).toHaveProperty('company', '');
    expect(body.formLoadedAt).toBe(3500);
    expect(body.locationSlug).toBe('brighton');
  });

  it('appointment sends company + formLoadedAt', () => {
    const body = buildAppointmentBody({
      name: 'Jane Doe',
      phone: '5551234567',
      preferredTime: 'Weekday afternoons',
      reportToken: 'tok',
      idempotencyKey: 'idem',
      honeypot: '',
      formLoadedAt: 4000,
      attribution,
    });
    expect(body).toHaveProperty('company', '');
    expect(body.formLoadedAt).toBe(4000);
    expect(body.idempotencyKey).toBe('idem');
  });

  it('appointment forwards the optional property fields for lead creation', () => {
    const body = buildAppointmentBody({
      name: 'Jane Doe',
      phone: '5551234567',
      preferredTime: '',
      propertyAddress: '1 Main St, Brighton, MI 48116, USA',
      propertyLat: 42.5,
      propertyLng: -83.8,
      propertyCity: 'Brighton',
      propertyState: 'MI',
      propertyZip: '48116',
      idempotencyKey: 'idem',
      honeypot: '',
      formLoadedAt: 4100,
      attribution,
    });
    expect(body.propertyAddress).toBe('1 Main St, Brighton, MI 48116, USA');
    expect(body.propertyLat).toBe(42.5);
    expect(body.propertyLng).toBe(-83.8);
    expect(body.propertyState).toBe('MI');
  });

  it('appointment omits property fields entirely when no address is entered', () => {
    const body = buildAppointmentBody({
      name: 'Jane Doe',
      phone: '5551234567',
      preferredTime: '',
      idempotencyKey: 'idem',
      honeypot: '',
      formLoadedAt: 4200,
      attribution,
    });
    expect(body.propertyAddress).toBeUndefined();
    expect(body.propertyLat).toBeUndefined();
  });

  it('collapses an unset formLoadedAt (0) to undefined but keeps the key present', () => {
    const body = buildAppointmentBody({
      name: 'Jane Doe',
      phone: '5551234567',
      preferredTime: '',
      idempotencyKey: 'idem',
      honeypot: '',
      formLoadedAt: 0,
      attribution,
    });
    expect(body.formLoadedAt).toBeUndefined();
    expect('formLoadedAt' in body).toBe(true);
  });

  it('attribution can never clobber the abuse signals', () => {
    // A future attribution field colliding on these names must not win.
    const body = buildGuideLeadBody({
      sessionId: 'sess',
      firstName: 'Jane',
      email: 'jane@example.com',
      locationSlug: '',
      honeypot: 'bot',
      formLoadedAt: 5,
      attribution: { company: 'evil', formLoadedAt: 999 } as unknown as typeof attribution,
    });
    expect(body.company).toBe('bot');
    expect(body.formLoadedAt).toBe(5);
  });
});
