/**
 * Request-body builders for the public lead forms (P0.3).
 *
 * Every public write must carry the two abuse signals the server evaluates —
 * the `company` honeypot and the `formLoadedAt` timing stamp (see
 * lib/abuseMitigation.ts). Those signals were dormant on the main funnel
 * because each form assembled its own `fetch` body inline and silently omitted
 * them: the server checked fields the client never sent, so the honeypot and
 * timing gates were no-ops on the primary PPC entry forms.
 *
 * Centralising body construction here fixes that permanently — "did this form
 * send the abuse signals?" becomes a property a unit test can assert, so the
 * client/server wiring gap cannot reopen unnoticed the next time a form is
 * edited. The builders are pure and use relative imports only, so
 * tests/leadRequests.test.ts can import them under vitest's node environment
 * (lessons-learned §17).
 */
import type { Attribution } from './attribution';

/** The abuse signals every public form must send with each write (P0.3). */
export interface AbuseSignalInput {
  /** Raw honeypot value read from the live form. Empty string for a human. */
  honeypot: string;
  /** ms timestamp captured when the form mounted; 0 before it is set. */
  formLoadedAt: number;
}

/**
 * The two fields the server's `evaluateAbuseSignals` reads. Spread LAST into
 * every body so nothing else can clobber them. `formLoadedAt` collapses to
 * undefined when unset (0) rather than sending a misleading epoch-zero stamp.
 */
function abuseFields(input: AbuseSignalInput): {
  company: string;
  formLoadedAt: number | undefined;
} {
  return { company: input.honeypot, formLoadedAt: input.formLoadedAt || undefined };
}

/* -------------------------------------------------------------------------- */
/* Valuation form (HeroValuation) — two writes: the pre-contact partial and    */
/* the final submit.                                                           */
/* -------------------------------------------------------------------------- */

export interface ValuationPartialInput extends AbuseSignalInput {
  sessionId: string;
  propertyAddress: string;
  propertyLat: number | null;
  propertyLng: number | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
  locationSlug?: string;
  pageVariant: 'seo' | 'ads';
  attribution: Attribution;
}

/**
 * Address-only partial, posted when the visitor picks an address (before any
 * contact details exist). The honeypot input lives in the later contact step,
 * so `company` is normally empty here — the timing stamp is the signal that
 * actually protects this endpoint. Both keys are still sent so a bot that skips
 * straight to the contact step cannot dodge the honeypot on the write that
 * matters.
 */
export function buildValuationPartialBody(input: ValuationPartialInput) {
  return {
    sessionId: input.sessionId,
    propertyAddress: input.propertyAddress,
    propertyLat: input.propertyLat,
    propertyLng: input.propertyLng,
    propertyCity: input.propertyCity ?? undefined,
    propertyState: input.propertyState ?? undefined,
    propertyZip: input.propertyZip ?? undefined,
    locationSlug: input.locationSlug || undefined,
    pageVariant: input.pageVariant,
    ...input.attribution,
    ...abuseFields(input),
  };
}

export interface ValuationSubmitInput extends AbuseSignalInput {
  sessionId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  timeframe?: string;
  propertyAddress: string;
  propertyLat: number | null;
  propertyLng: number | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
  valuationToken?: string;
  locationSlug: string;
  pageVariant: 'seo' | 'ads';
  attribution: Attribution;
}

/** Final valuation submit — the PII write the honeypot most needs to guard. */
export function buildValuationSubmitBody(input: ValuationSubmitInput) {
  return {
    sessionId: input.sessionId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    timeframe: input.timeframe || undefined,
    propertyAddress: input.propertyAddress,
    propertyLat: input.propertyLat,
    propertyLng: input.propertyLng,
    propertyCity: input.propertyCity ?? undefined,
    propertyState: input.propertyState ?? undefined,
    propertyZip: input.propertyZip ?? undefined,
    valuationToken: input.valuationToken ?? undefined,
    leadType: 'valuation' as const,
    locationSlug: input.locationSlug || '',
    pageVariant: input.pageVariant,
    ...input.attribution,
    ...abuseFields(input),
  };
}

/* -------------------------------------------------------------------------- */
/* Guide download (GuideCaptureForm) — home and city share one body shape.     */
/* -------------------------------------------------------------------------- */

export interface GuideLeadInput extends AbuseSignalInput {
  sessionId: string;
  firstName: string;
  email: string;
  /** '' on the homepage (routes by proximity); the city slug on city pages. */
  locationSlug: string;
  /** DB guide id on the homepage block; omitted for the city banner. */
  guideId?: number | null;
  attribution: Attribution;
}

export function buildGuideLeadBody(input: GuideLeadInput) {
  return {
    sessionId: input.sessionId,
    firstName: input.firstName,
    email: input.email,
    leadType: 'seller_guide' as const,
    ...(input.guideId != null ? { guideId: input.guideId } : {}),
    locationSlug: input.locationSlug,
    ...input.attribution,
    ...abuseFields(input),
  };
}

/* -------------------------------------------------------------------------- */
/* Appointment request (AppointmentForm).                                      */
/* -------------------------------------------------------------------------- */

export interface AppointmentInput extends AbuseSignalInput {
  name: string;
  phone: string;
  email?: string;
  preferredTime: string;
  /** Optional property (Places autocomplete). Lets a tokenless appointment
   *  create and route a real lead; prefilled from the existing lead with a token. */
  propertyAddress?: string | null;
  propertyLat?: number | null;
  propertyLng?: number | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
  /** The capability that authorizes attaching the request to a lead (P0.3). */
  reportToken?: string | null;
  idempotencyKey: string;
  attribution: Attribution;
}

export function buildAppointmentBody(input: AppointmentInput) {
  return {
    name: input.name,
    phone: input.phone,
    email: input.email || undefined,
    preferredTime: input.preferredTime,
    propertyAddress: input.propertyAddress || undefined,
    propertyLat: input.propertyLat ?? undefined,
    propertyLng: input.propertyLng ?? undefined,
    propertyCity: input.propertyCity || undefined,
    propertyState: input.propertyState || undefined,
    propertyZip: input.propertyZip || undefined,
    reportToken: input.reportToken ?? undefined,
    idempotencyKey: input.idempotencyKey,
    ...input.attribution,
    ...abuseFields(input),
  };
}
