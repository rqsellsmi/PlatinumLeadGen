/**
 * Lead identity + what the browser is allowed to receive (P0.1, decision D3).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * Neither a matching property ADDRESS nor a matching CONTACT (email or phone)
 * proves the person at the keyboard is the person on file:
 *
 *   - address:  a spouse, tenant, new owner, neighbour or someone who mistyped
 *               a house number reaches the same record. (This was the released
 *               defect — the old cross-session address dedup handed back the
 *               prior lead's id and report token, and /thank-you then rendered
 *               their name, email and phone.)
 *   - contact:  anyone who knows a victim's email or phone — plus recycled and
 *               shared phone numbers, and plain typos — reaches the same record.
 *
 * So identity work splits in two:
 *
 *   INTERNAL (safe, no disclosure). A contact match suppresses a duplicate
 *   acquisition conversion, records the valuation run on the existing lead's
 *   timeline, and flags a reconciliation candidate.
 *
 *   DISCLOSURE (requires verified POSSESSION). Revealing an existing lead's id,
 *   report token, or any PII requires the person to prove they hold the
 *   account — today by clicking the report link we email to the address ON
 *   FILE. A freshly-created lead is its own proof: the browser just created it,
 *   so it may have its own token.
 *
 * `buildSubmitResponse` is the single place that decides what leaves the
 * server, and it is pure so the acceptance tests in tests/leadIdentity.test.ts
 * can assert the invariant directly. Keep it that way — if a future change
 * needs to return more, it belongs behind a possession check, not here.
 *
 * Relative imports only: vitest has no `@/` alias for lib (lessons-learned §17).
 */

/** The minimum a caller needs to know about a matched lead. Never PII. */
export interface MatchedLead {
  id: number;
  status: string;
  /** The email ON FILE — the only address a possession-proving link may go to. */
  email: string | null;
}

export type LeadIdentityDecision =
  /** Contact matches a Lost lead: reopen it internally and route it again. */
  | { kind: 'reopen'; leadId: number; onFileEmail: string | null }
  /** Contact matches a live lead: record the run internally, disclose nothing. */
  | { kind: 'duplicate_contact'; leadId: number; onFileEmail: string | null }
  /** This browser's own un-contacted partial: upgrade it in place. */
  | { kind: 'update_partial'; leadId: number }
  /** Nothing matched, or nothing matched safely: a brand-new lead. */
  | { kind: 'create' };

/**
 * Decide which row a submit belongs to.
 *
 * Deliberately absent: any branch keyed on the property address. One lead may
 * run valuations on many addresses (D3), and one address may be run by many
 * unrelated people — so the address is a household hint recorded on the
 * timeline, never an identity.
 *
 * `sessionPartial` must already be scoped to a contact-less partial (email IS
 * NULL) belonging to THIS browser session. A session that has already produced
 * a full lead does not get overwritten when a different contact submits from
 * the same browser — that is a second person, so it becomes a second lead.
 */
export function decideLeadIdentity(input: {
  contactMatch: MatchedLead | null;
  sessionPartial: { id: number } | null;
}): LeadIdentityDecision {
  const { contactMatch, sessionPartial } = input;

  if (contactMatch) {
    if (contactMatch.status === 'lost') {
      return { kind: 'reopen', leadId: contactMatch.id, onFileEmail: contactMatch.email };
    }
    return {
      kind: 'duplicate_contact',
      leadId: contactMatch.id,
      onFileEmail: contactMatch.email,
    };
  }

  if (sessionPartial) return { kind: 'update_partial', leadId: sessionPartial.id };

  return { kind: 'create' };
}

/**
 * The response body for a lead that the browser itself just created (or
 * upgraded from its own partial). This is the only shape carrying a lead id or
 * a report token.
 */
export interface OwnLeadResponse {
  success: true;
  leadId: number;
  reportToken: string | null;
}

/**
 * The response body for a contact match. Carries NO lead id, NO report token
 * and NO PII — only whether we were able to send the report link to the
 * address on file, so the form can say "check your email" instead of pretending
 * nothing happened.
 */
export interface ExistingRecordResponse {
  success: true;
  existingRecord: true;
  reportLinkEmailed: boolean;
}

export type SubmitResponse = OwnLeadResponse | ExistingRecordResponse;

/**
 * Build the response body. The `decision` alone determines whether a token can
 * be disclosed; `ownLead` is ignored for contact matches even if a caller
 * mistakenly passes one.
 */
export function buildSubmitResponse(
  decision: LeadIdentityDecision,
  ctx: {
    /** Set only for a lead this browser created/upgraded itself. */
    ownLead?: { leadId: number; reportToken: string | null };
    /** Did we manage to email the report link to the address on file? */
    reportLinkEmailed?: boolean;
  },
): SubmitResponse {
  if (decision.kind === 'duplicate_contact' || decision.kind === 'reopen') {
    // Possession is NOT verified. Disclose nothing about the existing record —
    // not its id, not its token, not whether the submitted email or the
    // submitted phone was the field that matched.
    return {
      success: true,
      existingRecord: true,
      reportLinkEmailed: ctx.reportLinkEmailed === true,
    };
  }

  return {
    success: true,
    leadId: ctx.ownLead?.leadId ?? 0,
    reportToken: ctx.ownLead?.reportToken ?? null,
  };
}

/**
 * Where a possession-proving report link may be sent.
 *
 * Always the address ON FILE, never the address just typed into the form. If a
 * submit matched on PHONE while carrying a different email, mailing the
 * submitted address would hand the record straight to whoever typed it — the
 * leak this whole file exists to prevent. Mailing the on-file address instead
 * means the worst case is that the real owner receives a link to their own
 * report.
 */
export function reportLinkRecipient(decision: LeadIdentityDecision): string | null {
  if (decision.kind === 'duplicate_contact' || decision.kind === 'reopen') {
    return decision.onFileEmail;
  }
  return null;
}
