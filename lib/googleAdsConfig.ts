/**
 * Config for the Google Ads Data Manager offline-conversion integration
 * (docs/superpowers/specs/2026-07-24-google-ads-lead-stage-tracking-design.md).
 *
 * The CRM sends three server-side offline conversions — Valid Seller Lead
 * (first Nurturing), Listing Signed (first Signed), Closed (first Closed) — via
 * Google's Data Manager API. This module is pure config: no DB, no network.
 *
 * All getters use `||` (not `??`) so an EMPTY GitHub Actions/Vercel secret
 * falls back to the default instead of overriding it with '' (lessons §12d).
 * No secrets live in source.
 */

export type OutboxMilestone =
  // Website / acquisition (fired when the lead is captured)
  | 'seller_valuation'
  | 'guide_download'
  /**
   * A lead ACQUIRED through the appointment-request form — i.e. the form was
   * the first touch, so a new lead was created from it (D4 continuation). This
   * is the acquisition counterpart to `seller_valuation` / `guide_download`,
   * distinct from `appointment_requested` (which fires for every appointment
   * submission, including on leads that already converted).
   */
  | 'appointment_lead'
  /**
   * The public appointment-request FORM. A lead SIGNAL, not a verified
   * appointment — the visitor asked, nobody has confirmed anything (D4).
   * Configure this action as SECONDARY (observation only) in Google Ads so
   * scheduler-funnel measurement survives without inflating bidding.
   */
  | 'appointment_requested'
  // Pipeline / outcome (fired server-side from the CRM status flow)
  /**
   * The AGENT confirmed an appointment. This is the bidding-quality
   * "Appointment" conversion (D4 MODIFIED) — it reflects a real appointment,
   * so it is the one that may carry a bidding goal.
   */
  | 'appointment_set'
  | 'valid_seller_lead'
  | 'listing_signed'
  | 'closed';

export const OUTBOX_MILESTONES: readonly OutboxMilestone[] = [
  'seller_valuation',
  'guide_download',
  'appointment_lead',
  'appointment_requested',
  'appointment_set',
  'valid_seller_lead',
  'listing_signed',
  'closed',
] as const;

// Data Manager ConsentStatus enum members (verified against the live API — the
// vendor doc's CONSENT_STATUS_UNSPECIFIED is NOT valid; the prefix is CONSENT_).
export type ConsentValue =
  | 'CONSENT_UNSPECIFIED'
  | 'CONSENT_GRANTED'
  | 'CONSENT_DENIED';

/** Google Ads customer id, digits only (Data Manager operatingAccount.accountId). */
export function googleAdsCustomerId(): string {
  return (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/[^0-9]/g, '');
}

/** The offline conversion action id (Data Manager productDestinationId) per milestone. */
export function conversionActionId(milestone: OutboxMilestone): string {
  switch (milestone) {
    case 'seller_valuation':
      return process.env.GOOGLE_ADS_ACTION_ID_SELLER_VALUATION || '';
    case 'guide_download':
      return process.env.GOOGLE_ADS_ACTION_ID_GUIDE_DOWNLOAD || '';
    case 'appointment_lead':
      return process.env.GOOGLE_ADS_ACTION_ID_APPOINTMENT_LEAD || '';
    case 'appointment_requested':
      return process.env.GOOGLE_ADS_ACTION_ID_APPOINTMENT || '';
    case 'appointment_set':
      return process.env.GOOGLE_ADS_ACTION_ID_APPOINTMENT_SET || '';
    case 'valid_seller_lead':
      return process.env.GOOGLE_ADS_ACTION_ID_VALID_SELLER_LEAD || '';
    case 'listing_signed':
      return process.env.GOOGLE_ADS_ACTION_ID_LISTING_SIGNED || '';
    case 'closed':
      return process.env.GOOGLE_ADS_ACTION_ID_CLOSED || '';
  }
}

/**
 * Consent value sent on every event. Resolved decision D1: a CONSTANT for
 * US/Michigan first-party ads (Google's EU-user-consent policy doesn't apply to
 * US traffic). Default UNSPECIFIED; set GOOGLE_ADS_CONSENT=granted to treat
 * privacy-policy acceptance as consent.
 */
export function consentValue(): ConsentValue {
  const v = (process.env.GOOGLE_ADS_CONSENT || 'unspecified').trim().toLowerCase();
  if (v === 'granted') return 'CONSENT_GRANTED';
  if (v === 'denied') return 'CONSENT_DENIED';
  return 'CONSENT_UNSPECIFIED';
}

/** validateOnly=true during QA (Data Manager validates without recording). */
export function validateOnly(): boolean {
  return (process.env.GOOGLE_ADS_VALIDATE_ONLY || '') === '1';
}

/**
 * Approved lead_type values eligible for export (decision D11). Today every
 * capture flow is the seller-valuation workflow, so the default is the two
 * seller lead types; third-party `webhook` leads are excluded until added.
 * Override with a comma list in GOOGLE_ADS_ELIGIBLE_LEAD_TYPES.
 */
export function eligibleLeadTypes(): string[] {
  const raw = (process.env.GOOGLE_ADS_ELIGIBLE_LEAD_TYPES || 'valuation,seller_guide').trim();
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Is the integration configured enough to enqueue/send? Requires the customer
 * id and a service-account key. When false the whole feature no-ops silently
 * (no outbox rows written, worker sends nothing) — same fail-safe posture as
 * the Telnyx SMS layer (current-state §4.7).
 */
export function googleAdsConfigured(): boolean {
  return Boolean(googleAdsCustomerId()) && Boolean(process.env.GOOGLE_ADS_SA_KEY || '');
}
