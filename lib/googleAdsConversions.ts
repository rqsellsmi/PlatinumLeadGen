'use client';

/**
 * Google Ads conversion tracking (v1.6 §B, with §K.6 corrections).
 *
 * These fire gtag conversion events directly to Google Ads (account
 * AW-17043745770) — NOT dataLayer pushes. The gtag function is loaded by the
 * Google Ads tag inside GTM, so it is available on all public pages.
 *
 * Rules:
 *  - Fire ONLY after a confirmed backend save (never speculatively).
 *  - transaction_id dedups: same id never counts twice. Some types use a prefix
 *    ('hero-', 'appointment-') to avoid cross-type collisions (§K.6).
 *  - Enhanced conversions: user data (email/phone/name) is hashed client-side by
 *    Google before sending. We persist it in sessionStorage so later conversions
 *    in the same session (e.g. the appointment on the thank-you page) can fire
 *    with user data without re-passing it (§K.6).
 */

declare function gtag(...args: unknown[]): void;

const ADS_ID = 'AW-17043745770';
const USER_DATA_KEY = 'remax_google_ads_user_data';

export interface AdsUserData {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

function hasGtag(): boolean {
  return typeof gtag !== 'undefined';
}

function readStoredUserData(): AdsUserData {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(USER_DATA_KEY) ?? '{}') as AdsUserData;
  } catch {
    return {};
  }
}

function writeStoredUserData(d: AdsUserData): void {
  if (typeof window === 'undefined') return;
  try {
    const merged = { ...readStoredUserData(), ...clean(d) };
    sessionStorage.setItem(USER_DATA_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
}

function clean(d: AdsUserData): AdsUserData {
  const out: AdsUserData = {};
  if (d.email) out.email = d.email;
  if (d.phone) out.phone = d.phone;
  if (d.name) out.name = d.name;
  return out;
}

/**
 * Set enhanced-conversion user data before firing a conversion. Merges any newly
 * provided data with what's stored for the session.
 */
function setEnhancedConversionUserData(provided?: AdsUserData): void {
  if (!hasGtag()) return;
  if (provided) writeStoredUserData(provided);
  const ud = readStoredUserData();
  if (!ud.email && !ud.phone && !ud.name) return;
  const userData: Record<string, unknown> = {};
  if (ud.email) userData.email = ud.email;
  if (ud.phone) userData.phone_number = ud.phone;
  if (ud.name) {
    const parts = ud.name.trim().split(/\s+/);
    userData.address = { first_name: parts[0], last_name: parts.slice(1).join(' ') };
  }
  gtag('set', 'user_data', userData);
}

function fireConversion(label: string, value: number, transactionId?: string): void {
  if (!hasGtag()) return;
  const payload: Record<string, unknown> = {
    send_to: `${ADS_ID}/${label}`,
    value,
    currency: 'USD',
  };
  if (transactionId) payload.transaction_id = transactionId;
  gtag('event', 'conversion', payload);
}

// --- The 4 conversion actions (labels + values from §B.2 / §K.6) ---

/** Seller Valuation Lead — $100, SEO valuation pages. transaction_id = leadId. */
export function fireSellerValuationConversion(leadId: number, userData?: AdsUserData): void {
  setEnhancedConversionUserData(userData);
  fireConversion('P13JCP6ArqUcEOrXi78_', 100, String(leadId));
}

/** Hero Seller Lead — $75, PPC (/ads) pages. transaction_id = `hero-${leadId}`. */
export function fireHeroSellerLeadConversion(leadId: number, userData?: AdsUserData): void {
  setEnhancedConversionUserData(userData);
  fireConversion('CJ-HCIGBrqUcEOrXi78_', 75, `hero-${leadId}`);
}

/** Seller Guide Download — $20. transaction_id = leadId. */
export function fireSellerGuideConversion(leadId: number, email?: string | null): void {
  setEnhancedConversionUserData(email ? { email } : undefined);
  fireConversion('-EGYCJKDrqUcEOrXi78_', 20, String(leadId));
}

/** Appointment Request — $150. transaction_id = `appointment-${leadId}` when known. */
export function fireAppointmentRequestConversion(leadId?: number | null, email?: string | null): void {
  setEnhancedConversionUserData(email ? { email } : undefined);
  fireConversion(
    'YLtCCJWDrqUcEOrXi78_',
    150,
    leadId != null ? `appointment-${leadId}` : undefined,
  );
}
