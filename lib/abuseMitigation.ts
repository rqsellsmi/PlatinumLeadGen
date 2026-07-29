/**
 * Abuse mitigation for the public write endpoints (P0.3, decision D5 MODIFIED).
 *
 * TERMINOLOGY MATTERS HERE. These are ABUSE MITIGATION, not bot detection, and
 * calling them bot protection would overstate what they do:
 *
 *   - the same-origin check (middleware.ts) only blocks cross-origin BROWSER
 *     calls; a script that simply omits an Origin header walks past it;
 *   - idempotency only stops the same submission being processed twice;
 *   - rate limiting throttles volume per IP, so a distributed or low-and-slow
 *     bot slips through.
 *
 * What this module adds is two cheap, zero-friction deterrents that catch naive
 * form-filling bots — the overwhelming majority — with no CAPTCHA:
 *
 *   HONEYPOT: a field a human never sees and never fills.
 *   TIMING:   a floor on how fast a human can plausibly complete the form.
 *
 * Turnstile stays deferred to the buyer-side launch (D5), on the condition that
 * these interim measures exist and abuse is monitored. If the tripwire trips
 * (spam / invalid-lead rate above threshold), Turnstile ships earlier.
 *
 * Deliberately biased toward FLAG over BLOCK: a false positive here silently
 * loses a real seller lead that we paid Google for, which costs far more than
 * letting a spam row through. Only the honeypot hard-rejects, because a filled
 * hidden field has no innocent explanation.
 *
 * Pure — no DB, no env. Relative imports only (lessons-learned §17).
 */

/**
 * Minimum plausible time from form render to submit. Conservative on purpose:
 * a fast, prefilled, autofilled human can complete a three-field form quickly,
 * and this is well under that.
 */
export const MIN_COMPLETION_MS = 2000;

/** The honeypot field name. Innocuous enough that a bot will want to fill it. */
export const HONEYPOT_FIELD = 'company';

export type AbuseVerdict =
  /** Nothing suspicious — process normally. */
  | { action: 'accept' }
  /** Process, but mark it for review. Never lose a possibly-real lead. */
  | { action: 'flag'; reason: string }
  /** Refuse outright. Reserved for signals with no innocent explanation. */
  | { action: 'reject'; reason: string };

export interface AbuseSignals {
  /** Value of the hidden honeypot field, if the client sent one. */
  honeypot?: string | null;
  /** Client timestamp (ms since epoch) captured when the form was rendered. */
  formLoadedAt?: number | null;
  /** Injected for testing. */
  now?: number;
}

/**
 * Evaluate the cheap abuse signals on a public form submission.
 *
 * A MISSING signal is never held against the submitter. An older cached page,
 * a privacy extension stripping fields, or a client-side error would all
 * produce a submit with no timing value — and refusing those would break real
 * traffic to defend against something the honeypot already covers.
 */
export function evaluateAbuseSignals(signals: AbuseSignals): AbuseVerdict {
  // A hidden, aria-hidden, non-autofill field that came back with a value was
  // filled by something walking the DOM. No innocent explanation → reject.
  if (typeof signals.honeypot === 'string' && signals.honeypot.trim() !== '') {
    return { action: 'reject', reason: 'honeypot' };
  }

  const loadedAt = signals.formLoadedAt;
  if (typeof loadedAt === 'number' && Number.isFinite(loadedAt) && loadedAt > 0) {
    const now = signals.now ?? Date.now();
    const elapsed = now - loadedAt;

    // A timestamp from the future (or absurdly far past) means a skewed client
    // clock, not an attack — the value is unusable, so ignore it rather than
    // penalise someone whose laptop clock is wrong.
    if (elapsed < 0) return { action: 'accept' };

    if (elapsed < MIN_COMPLETION_MS) {
      // FLAG, not reject: the lead is still captured and routed. If this proves
      // noisy in production it can be tightened; if it proves clean it is
      // evidence for the Turnstile tripwire either way.
      return { action: 'flag', reason: 'too_fast' };
    }
  }

  return { action: 'accept' };
}

/**
 * Guard the request body size before parsing (D5: payload limits).
 * `content-length` is advisory, so this is a cheap first gate — it is not a
 * substitute for the schema's own per-field `max()` limits, which is where the
 * real bound lives.
 */
export function exceedsPayloadLimit(
  contentLength: string | null,
  limitBytes: number,
): boolean {
  if (!contentLength) return false;
  const n = Number(contentLength);
  return Number.isFinite(n) && n > limitBytes;
}

/** Max accepted body for the public JSON endpoints. Generous vs. real payloads. */
export const MAX_PUBLIC_BODY_BYTES = 16 * 1024;
