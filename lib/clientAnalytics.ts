'use client';

/** Push an event to the GTM dataLayer (Section 21.2). No-op if GTM absent. */
export function dataLayerPush(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event, ...params });
}

/** Smooth-scroll to the valuation form and focus its address input. */
export function scrollToValuation(): void {
  if (typeof document === 'undefined') return;
  const section = document.getElementById('valuation');
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    const input = document.getElementById('valuation-address') as HTMLInputElement | null;
    input?.focus();
  }, 400);
}

export const LEAD_SUBMITTED_FLAG = 'leadSubmitted';
export const EXIT_INTENT_FLAG = 'exitIntentShown';
export const PREFILL_ADDRESS_KEY = 'prefillAddress';
