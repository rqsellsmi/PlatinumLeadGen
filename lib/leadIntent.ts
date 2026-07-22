/**
 * Lead buyer/seller classification (migration 0026). This is a label only — it
 * has no effect on routing, scoring, or the offer flow. All current capture
 * flows are seller-side, so leads default to 'seller'; 'unknown' covers leads
 * whose intent isn't known (e.g. a future buyer webhook that doesn't send it).
 */
import type { PillTone } from '@/components/ui';

export const LEAD_INTENTS = ['seller', 'buyer', 'unknown'] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

export function isLeadIntent(v: unknown): v is LeadIntent {
  return typeof v === 'string' && (LEAD_INTENTS as readonly string[]).includes(v);
}

export function leadIntentLabel(v: string): string {
  const map: Record<LeadIntent, string> = {
    seller: 'Seller',
    buyer: 'Buyer',
    unknown: 'Unknown',
  };
  return (map as Record<string, string>)[v] ?? v;
}

/** Badge tone per classification, so buyer/seller read at a glance. */
export function leadIntentTone(v: string): PillTone {
  const map: Record<LeadIntent, PillTone> = {
    seller: 'info',
    buyer: 'purple',
    unknown: 'neutral',
  };
  return (map as Record<string, PillTone>)[v] ?? 'neutral';
}
