/**
 * Shared Zod validation schemas. The internal lead route and the external
 * webhook use the SAME schema (Section 7.2).
 */
import { z } from 'zod';

/** Shared user-facing message when a name fails the letter/no-number rule. */
export const INVALID_NAME_MESSAGE = 'Please enter a valid name (letters only, no numbers).';

/**
 * A person's name must contain at least one letter and no digits. Spaces,
 * apostrophes, hyphens, periods, and accented/unicode letters are allowed so
 * real names pass (O'Brien, Anne-Marie, José, Jr.). Blank/nullish is treated as
 * "not provided" and left to the field's own required check — this validates
 * FORMAT only, not presence.
 */
export function isValidPersonName(value: string | null | undefined): boolean {
  if (value == null) return true; // presence is enforced separately
  const v = value.trim();
  if (v === '') return true; // blank → "not provided"; not a format error
  if (/\d/.test(v)) return false; // no digits
  return /\p{L}/u.test(v); // must contain at least one letter
}

/** Zod field for an optional person name: length-bounded + letter/no-number format. */
const personNameField = () =>
  z
    .string()
    .max(120)
    .optional()
    .nullable()
    .refine(isValidPersonName, { message: INVALID_NAME_MESSAGE });

/** Attribution fields (v1.6 §C) — all optional, captured client-side. */
export const attributionFields = {
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmContent: z.string().max(200).optional().nullable(),
  utmTerm: z.string().max(200).optional().nullable(),
  gclid: z.string().max(500).optional().nullable(),
  gbraid: z.string().max(500).optional().nullable(),
  wbraid: z.string().max(500).optional().nullable(),
  referrer: z.string().max(1000).optional().nullable(),
  landingPageUrl: z.string().max(1000).optional().nullable(),
  deviceType: z.string().max(20).optional().nullable(),
  firstSeenAt: z.string().optional().nullable(),
  lastSeenAt: z.string().optional().nullable(),
};

export const partialLeadSchema = z.object({
  sessionId: z.string().min(1).max(128),
  propertyAddress: z.string().min(3).max(300),
  propertyCity: z.string().max(120).optional().nullable(),
  propertyState: z.string().max(10).optional().nullable(),
  propertyZip: z.string().max(20).optional().nullable(),
  propertyLat: z.number().optional().nullable(),
  propertyLng: z.number().optional().nullable(),
  locationSlug: z.string().max(120).optional().nullable(),
  pageVariant: z.enum(['seo', 'ads']).optional().nullable(),
  ...attributionFields,
});

export const leadSubmitSchema = z.object({
  sessionId: z.string().min(1).max(128),
  leadType: z.enum(['valuation', 'seller_guide', 'webhook']).default('valuation'),
  firstName: personNameField(),
  lastName: personNameField(),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  propertyAddress: z.string().max(300).optional().nullable(),
  propertyCity: z.string().max(120).optional().nullable(),
  propertyState: z.string().max(10).optional().nullable(),
  propertyZip: z.string().max(20).optional().nullable(),
  propertyLat: z.number().optional().nullable(),
  propertyLng: z.number().optional().nullable(),
  timeframe: z.string().max(80).optional().nullable(),
  estimatedValue: z.number().int().optional().nullable(),
  priceRangeLow: z.number().int().optional().nullable(),
  priceRangeHigh: z.number().int().optional().nullable(),
  // Opaque token linking this lead to its stored valuation (two-tier report).
  valuationToken: z.string().max(64).optional().nullable(),
  locationSlug: z.string().max(120).optional().nullable(),
  pageVariant: z.enum(['seo', 'ads']).optional().nullable(),
  ...attributionFields,
});

/** Webhook lead schema — same shape, plus an optional source label. */
export const webhookLeadSchema = leadSubmitSchema.extend({
  source: z.string().max(80).optional().nullable(),
});

/**
 * An agent editing the contact details on a lead they own. Names use the
 * shared letter/no-number rule; first name and email are required (they're the
 * lead's primary handles), last name and phone are optional.
 */
export const agentLeadContactSchema = z.object({
  leadOfferId: z.number().int().positive(),
  firstName: z
    .string()
    .trim()
    .min(1, { message: 'Enter a first name.' })
    .max(120)
    .refine(isValidPersonName, { message: INVALID_NAME_MESSAGE }),
  lastName: z
    .string()
    .trim()
    .max(120)
    .refine(isValidPersonName, { message: INVALID_NAME_MESSAGE })
    .optional()
    .nullable(),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
});

export type AgentLeadContactInput = z.infer<typeof agentLeadContactSchema>;

export const valuationSchema = z.object({
  address: z.string().min(3).max(300),
  propertyLat: z.number().optional().nullable(),
  propertyLng: z.number().optional().nullable(),
});

export const appointmentSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  preferredTime: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  leadId: z.number().int().optional().nullable(),
  ...attributionFields,
});

export type PartialLeadInput = z.infer<typeof partialLeadSchema>;
export type LeadSubmitInput = z.infer<typeof leadSubmitSchema>;
export type WebhookLeadInput = z.infer<typeof webhookLeadSchema>;
export type ValuationInput = z.infer<typeof valuationSchema>;
export type AppointmentInput = z.infer<typeof appointmentSchema>;
