/**
 * P0.1 acceptance tests (review items #9 / #58, decision D3 REVISED).
 *
 * These lock the released cross-lead exposure shut. Two invariants, stated as
 * the review states them:
 *
 *   1. "same address + different contact never returns prior token/PII"
 *   2. "a contact match never returns a token/PII without verified possession"
 *
 * The second is the one that is easy to lose again — it looks helpful to hand a
 * returning visitor their record back, and the old code did exactly that.
 */
import { describe, it, expect } from 'vitest';
import {
  decideLeadIdentity,
  buildSubmitResponse,
  reportLinkRecipient,
  isStrongContactMatch,
  type LeadIdentityDecision,
} from '../lib/leadIdentity';

const OTHER_PERSON = { id: 41, status: 'connected', email: 'victim@example.com' };

describe('decideLeadIdentity', () => {
  it('creates a NEW lead when nothing matches', () => {
    expect(decideLeadIdentity({ contactMatch: null, sessionPartial: null })).toEqual({
      kind: 'create',
    });
  });

  it('upgrades this browser session own contact-less partial', () => {
    expect(decideLeadIdentity({ contactMatch: null, sessionPartial: { id: 7 } })).toEqual({
      kind: 'update_partial',
      leadId: 7,
    });
  });

  it('treats a contact match as an internal duplicate, not an identity', () => {
    const d = decideLeadIdentity({ contactMatch: OTHER_PERSON, sessionPartial: null });
    expect(d.kind).toBe('duplicate_contact');
  });

  it('reopens a Lost lead whose contact came back', () => {
    const d = decideLeadIdentity({
      contactMatch: { id: 9, status: 'lost', email: 'a@b.com' },
      sessionPartial: null,
    });
    expect(d).toEqual({ kind: 'reopen', leadId: 9, onFileEmail: 'a@b.com' });
  });

  it('prefers the contact match over this session partial', () => {
    const d = decideLeadIdentity({ contactMatch: OTHER_PERSON, sessionPartial: { id: 7 } });
    expect(d.kind).toBe('duplicate_contact');
  });

  it('has NO address branch — the address never decides identity (D3)', () => {
    // Two different people submitting the same property address produce two
    // independent decisions, because the address is not an input at all.
    const first = decideLeadIdentity({ contactMatch: null, sessionPartial: null });
    const second = decideLeadIdentity({ contactMatch: null, sessionPartial: null });
    expect(first).toEqual({ kind: 'create' });
    expect(second).toEqual({ kind: 'create' });
  });
});

describe('buildSubmitResponse — what may leave the server', () => {
  it('gives a browser its OWN newly-created lead id and token', () => {
    const res = buildSubmitResponse(
      { kind: 'create' },
      { ownLead: { leadId: 100, reportToken: 'tok-abc' } },
    );
    expect(res).toEqual({ success: true, leadId: 100, reportToken: 'tok-abc' });
  });

  it('gives a browser its own upgraded partial id and token', () => {
    const res = buildSubmitResponse(
      { kind: 'update_partial', leadId: 7 },
      { ownLead: { leadId: 7, reportToken: 'tok-xyz' } },
    );
    expect(res).toEqual({ success: true, leadId: 7, reportToken: 'tok-xyz' });
  });

  // ---- The P0.1 invariants ------------------------------------------------

  it('NEVER returns a prior lead id or report token on a contact match', () => {
    const decision: LeadIdentityDecision = {
      kind: 'duplicate_contact',
      leadId: OTHER_PERSON.id,
      onFileEmail: OTHER_PERSON.email,
    };
    const res = buildSubmitResponse(decision, { reportLinkEmailed: true });

    expect(res).toEqual({ success: true, existingRecord: true, reportLinkEmailed: true });
    expect(res).not.toHaveProperty('leadId');
    expect(res).not.toHaveProperty('reportToken');
  });

  it('NEVER returns a prior lead id or report token on a reopen', () => {
    const res = buildSubmitResponse(
      { kind: 'reopen', leadId: 9, onFileEmail: 'a@b.com' },
      { reportLinkEmailed: true },
    );
    expect(res).not.toHaveProperty('leadId');
    expect(res).not.toHaveProperty('reportToken');
  });

  it('ignores an ownLead a caller wrongly passes alongside a contact match', () => {
    // Defence in depth: even if a future edit threads the matched lead through
    // as `ownLead`, the decision kind still governs disclosure.
    const res = buildSubmitResponse(
      { kind: 'duplicate_contact', leadId: 41, onFileEmail: 'victim@example.com' },
      { ownLead: { leadId: 41, reportToken: 'victim-token' }, reportLinkEmailed: false },
    );
    expect(JSON.stringify(res)).not.toContain('victim-token');
    expect(JSON.stringify(res)).not.toContain('41');
  });

  it('leaks no PII of the existing record in any field', () => {
    const res = buildSubmitResponse(
      { kind: 'duplicate_contact', leadId: 41, onFileEmail: 'victim@example.com' },
      { reportLinkEmailed: true },
    );
    const body = JSON.stringify(res);
    expect(body).not.toContain('victim@example.com');
  });

  it('reports honestly when the report link could not be emailed', () => {
    const res = buildSubmitResponse(
      { kind: 'duplicate_contact', leadId: 41, onFileEmail: null },
      { reportLinkEmailed: false },
    );
    expect(res).toEqual({ success: true, existingRecord: true, reportLinkEmailed: false });
  });

  it('defaults reportLinkEmailed to false rather than claiming success', () => {
    const res = buildSubmitResponse(
      { kind: 'duplicate_contact', leadId: 41, onFileEmail: 'x@y.com' },
      {},
    );
    expect(res).toEqual({ success: true, existingRecord: true, reportLinkEmailed: false });
  });
});

describe('reportLinkRecipient — possession proof goes to the address ON FILE', () => {
  it('emails the on-file address, never the submitted one', () => {
    // A submit that matched on PHONE while carrying attacker@example.com must
    // send the link to the record owner, not the submitter.
    const decision: LeadIdentityDecision = {
      kind: 'duplicate_contact',
      leadId: 41,
      onFileEmail: 'victim@example.com',
    };
    expect(reportLinkRecipient(decision)).toBe('victim@example.com');
  });

  it('returns null when the matched record has no email to verify against', () => {
    expect(
      reportLinkRecipient({ kind: 'duplicate_contact', leadId: 41, onFileEmail: null }),
    ).toBeNull();
  });

  it('returns null for a lead the browser created itself (nothing to verify)', () => {
    expect(reportLinkRecipient({ kind: 'create' })).toBeNull();
    expect(reportLinkRecipient({ kind: 'update_partial', leadId: 3 })).toBeNull();
  });
});

describe('isStrongContactMatch — auto-merge stays conservative (D3)', () => {
  it('requires BOTH email and phone to agree', () => {
    expect(
      isStrongContactMatch(
        { email: 'a@b.com', phone: '810-555-0134' },
        { email: 'A@B.com', phone: '(810) 555-0134' },
      ),
    ).toBe(true);
  });

  it('rejects a shared or recycled phone with a different email', () => {
    expect(
      isStrongContactMatch(
        { email: 'newowner@example.com', phone: '810-555-0134' },
        { email: 'prevowner@example.com', phone: '810-555-0134' },
      ),
    ).toBe(false);
  });

  it('rejects a matching email with a different phone', () => {
    expect(
      isStrongContactMatch(
        { email: 'a@b.com', phone: '810-555-0001' },
        { email: 'a@b.com', phone: '810-555-0134' },
      ),
    ).toBe(false);
  });

  it('rejects when either side is missing a field', () => {
    expect(isStrongContactMatch({ email: 'a@b.com', phone: null }, { email: 'a@b.com', phone: '8105550134' })).toBe(false);
    expect(isStrongContactMatch({ email: null, phone: '8105550134' }, { email: 'a@b.com', phone: '8105550134' })).toBe(false);
  });

  it('rejects an unusably short phone rather than matching on noise', () => {
    expect(isStrongContactMatch({ email: 'a@b.com', phone: '123' }, { email: 'a@b.com', phone: '123' })).toBe(false);
  });
});
