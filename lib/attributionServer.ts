/**
 * Server-side attribution helper (v1.6 §C.4).
 * Maps validated attribution input (string timestamps) to DB column values that
 * are shared by the leads and appointment_requests tables.
 */

export interface AttributionInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  referrer?: string | null;
  landingPageUrl?: string | null;
  deviceType?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export interface AttributionColumns {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  referrer: string | null;
  landingPageUrl: string | null;
  deviceType: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function attributionColumns(input: AttributionInput): AttributionColumns {
  return {
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    utmContent: input.utmContent ?? null,
    utmTerm: input.utmTerm ?? null,
    gclid: input.gclid ?? null,
    gbraid: input.gbraid ?? null,
    wbraid: input.wbraid ?? null,
    referrer: input.referrer ?? null,
    landingPageUrl: input.landingPageUrl ?? null,
    deviceType: input.deviceType ?? null,
    firstSeenAt: toDate(input.firstSeenAt),
    lastSeenAt: toDate(input.lastSeenAt),
  };
}
