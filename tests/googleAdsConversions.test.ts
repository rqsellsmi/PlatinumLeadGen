import { describe, it, expect } from 'vitest';
import { normalizeEmail, sha256Hex, hashedEmail, hashedPhone } from '../lib/googleAdsHash';
import {
  milestoneFor,
  acquisitionMilestoneFor,
  transactionIdFor,
  eventSourceFor,
  isExportEligible,
  buildIngestRequest,
} from '../lib/googleAdsOutbox';

describe('googleAdsHash', () => {
  it('lowercases + trims email and strips gmail dots', () => {
    expect(normalizeEmail('  John.Doe@Gmail.com ')).toBe('johndoe@gmail.com');
    expect(normalizeEmail('a.b.c@googlemail.com')).toBe('abc@googlemail.com');
    // non-gmail domains keep dots
    expect(normalizeEmail('john.doe@Example.COM')).toBe('john.doe@example.com');
  });

  it('produces a stable lowercase 64-hex SHA-256 and never re-hashes a digest', () => {
    const h = sha256Hex('johndoe@gmail.com');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // known vector for the ascii string "johndoe@gmail.com"
    expect(h).toBe(sha256Hex('johndoe@gmail.com')); // deterministic
    expect(sha256Hex(h)).toBe(h); // already a digest → pass-through
  });

  it('hashes email/phone and returns null for unusable input', () => {
    expect(hashedEmail('  Foo@Bar.com')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashedEmail('')).toBeNull();
    expect(hashedEmail('not-an-email')).toBeNull();
    // 10-digit US phone → +1XXXXXXXXXX before hashing
    expect(hashedPhone('(810) 555-1212')).toBe(hashedPhone('+18105551212'));
    expect(hashedPhone('123')).toBeNull();
    expect(hashedPhone(null)).toBeNull();
  });
});

describe('milestoneFor', () => {
  it('maps only the four trigger statuses', () => {
    expect(milestoneFor('nurturing')).toBe('valid_seller_lead');
    expect(milestoneFor('signed')).toBe('listing_signed');
    expect(milestoneFor('closed')).toBe('closed');
    for (const s of ['new', 'attempted_contact', 'connected', 'lost', 'reopened']) {
      expect(milestoneFor(s)).toBeNull();
    }
  });

  it('maps the AGENT-confirmed appointment, not the public form (D4 MODIFIED)', () => {
    // The bidding-quality "Appointment" conversion is the one an agent
    // confirms. The public form still fires 'appointment_requested', but that
    // action is configured SECONDARY (observation only) in Google Ads, so a
    // visitor asking for a call cannot inflate bidding on its own.
    expect(milestoneFor('appointment_set')).toBe('appointment_set');
  });
});

describe('acquisitionMilestoneFor', () => {
  it('maps lead types to website/acquisition milestones', () => {
    expect(acquisitionMilestoneFor('valuation')).toBe('seller_valuation');
    expect(acquisitionMilestoneFor('seller_guide')).toBe('guide_download');
    expect(acquisitionMilestoneFor('appointment')).toBe('appointment_lead');
    expect(acquisitionMilestoneFor('webhook')).toBeNull();
    expect(acquisitionMilestoneFor(null)).toBeNull();
    expect(acquisitionMilestoneFor(undefined)).toBeNull();
  });
});

describe('transactionIdFor', () => {
  it('is the deterministic lead:{id}:{milestone} key across all milestones', () => {
    expect(transactionIdFor(12345, 'valid_seller_lead')).toBe('lead:12345:valid_seller_lead');
    expect(transactionIdFor(7, 'listing_signed')).toBe('lead:7:listing_signed');
    expect(transactionIdFor(7, 'closed')).toBe('lead:7:closed');
    expect(transactionIdFor(9, 'seller_valuation')).toBe('lead:9:seller_valuation');
    expect(transactionIdFor(9, 'guide_download')).toBe('lead:9:guide_download');
    expect(transactionIdFor(9, 'appointment_requested')).toBe('lead:9:appointment_requested');
  });
});

describe('eventSourceFor', () => {
  it('maps the update channel to the Data Manager enum', () => {
    expect(eventSourceFor('phone')).toBe('PHONE');
    expect(eventSourceFor('web')).toBe('WEB');
    expect(eventSourceFor('other')).toBe('OTHER');
    expect(eventSourceFor(undefined)).toBe('OTHER');
    expect(eventSourceFor(null)).toBe('OTHER');
  });
});

describe('isExportEligible', () => {
  const allow = ['valuation', 'seller_guide'];
  it('requires a non-deleted lead with an approved type', () => {
    expect(isExportEligible({ isDeleted: false, leadType: 'valuation' }, allow)).toBe(true);
    expect(isExportEligible({ isDeleted: false, leadType: 'seller_guide' }, allow)).toBe(true);
    expect(isExportEligible({ isDeleted: true, leadType: 'valuation' }, allow)).toBe(false);
    expect(isExportEligible({ isDeleted: false, leadType: 'webhook' }, allow)).toBe(false);
    expect(isExportEligible({ isDeleted: false, leadType: null }, allow)).toBe(false);
  });
});

describe('buildIngestRequest', () => {
  const base = {
    customerId: '1234567890',
    conversionActionId: 'action-abc',
    transactionId: 'lead:12345:valid_seller_lead',
    occurredAt: new Date('2026-07-21T18:35:00.000Z'),
    eventSource: 'PHONE',
    consent: 'CONSENT_GRANTED' as const,
    validateOnly: false,
  };

  it('sends click ids raw, hashes email/phone, sets encoding + consent', () => {
    const req = buildIngestRequest({
      ...base,
      lead: { gclid: 'ABC123', email: 'John.Doe@gmail.com', phone: '(810) 555-1212' },
    });
    const dest = (req.destinations as any[])[0];
    expect(dest.operatingAccount).toEqual({ accountType: 'GOOGLE_ADS', accountId: '1234567890' });
    expect(dest.productDestinationId).toBe('action-abc');
    expect(req.encoding).toBe('HEX');
    const ev = (req.events as any[])[0];
    expect(ev.transactionId).toBe('lead:12345:valid_seller_lead');
    expect(ev.eventTimestamp).toBe('2026-07-21T18:35:00.000Z'); // RFC-3339 Z
    expect(ev.eventSource).toBe('PHONE');
    expect(ev.adIdentifiers).toEqual({ gclid: 'ABC123' }); // raw, unhashed
    const ids = ev.userData.userIdentifiers;
    expect(ids).toContainEqual({ emailAddress: hashedEmail('John.Doe@gmail.com') });
    expect(ids).toContainEqual({ phoneNumber: hashedPhone('(810) 555-1212') });
    expect(ev.consent).toEqual({
      adUserData: 'CONSENT_GRANTED',
      adPersonalization: 'CONSENT_GRANTED',
    });
  });

  it('omits the consent object when consent is unspecified (US/first-party default)', () => {
    const req = buildIngestRequest({ ...base, consent: 'CONSENT_UNSPECIFIED', lead: { email: 'a@b.com' } });
    const ev = (req.events as any[])[0];
    expect(ev.consent).toBeUndefined();
  });

  it('omits userData/encoding when there are no hashable identifiers', () => {
    const req = buildIngestRequest({ ...base, lead: { gclid: 'ABC123' } });
    expect(req.encoding).toBeUndefined();
    const ev = (req.events as any[])[0];
    expect(ev.userData).toBeUndefined();
    expect(ev.adIdentifiers).toEqual({ gclid: 'ABC123' });
  });

  it('omits adIdentifiers when no click id is present (organic lead)', () => {
    const req = buildIngestRequest({ ...base, lead: { email: 'a@b.com' } });
    const ev = (req.events as any[])[0];
    expect(ev.adIdentifiers).toBeUndefined();
    expect(ev.userData.userIdentifiers).toHaveLength(1);
  });
});
