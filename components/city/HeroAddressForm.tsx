'use client';

import * as React from 'react';
import { PREFILL_ADDRESS_KEY, scrollToValuation } from '@/lib/clientAnalytics';

/**
 * Inline address capture that lives in the bold hero. It does NOT submit a
 * lead on its own — it hands the typed address to the single valuation form
 * below (via the `prefill-address` event the form already listens for) and
 * smooth-scrolls to it, so there is exactly one lead-capture path on the page.
 */
export default function HeroAddressForm() {
  const [address, setAddress] = React.useState('');

  function handSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = address.trim();
    if (value) {
      try {
        sessionStorage.setItem(PREFILL_ADDRESS_KEY, value);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('prefill-address', { detail: value }));
    }
    scrollToValuation();
  }

  return (
    <form
      onSubmit={handSubmit}
      className="flex max-w-xl flex-wrap gap-2.5 rounded-2xl bg-white p-2.5 shadow-[0_18px_48px_rgba(20,20,24,0.3)]"
    >
      <div className="flex flex-1 basis-60 items-center gap-2.5 rounded-xl border-[1.5px] border-line px-4">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-platinum-red"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter your home address"
          aria-label="Your home address"
          className="w-full border-none bg-transparent py-4 text-base text-ink outline-none placeholder:text-mute-lighter"
        />
      </div>
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-platinum-red px-6 py-4 text-base font-bold text-white transition-colors hover:bg-platinum-redHover"
      >
        Get My Value →
      </button>
    </form>
  );
}
