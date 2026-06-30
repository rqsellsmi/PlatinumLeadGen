'use client';

import * as React from 'react';
import {
  dataLayerPush,
  scrollToValuation,
  EXIT_INTENT_FLAG,
  LEAD_SUBMITTED_FLAG,
  PREFILL_ADDRESS_KEY,
} from '@/lib/clientAnalytics';

/**
 * Exit-intent overlay (Section 22.2). Desktop only. Triggers on mouseleave
 * toward the browser chrome (clientY <= 0). Once per session; not shown if a
 * lead was already submitted. The address handoff goes to the main valuation
 * form via sessionStorage + a custom event.
 */
export default function ExitIntentOverlay() {
  const [open, setOpen] = React.useState(false);
  const [address, setAddress] = React.useState('');

  React.useEffect(() => {
    // Desktop only — skip coarse-pointer (touch) devices.
    if (window.matchMedia('(pointer: coarse)').matches) return;

    function onLeave(e: MouseEvent) {
      if (e.clientY > 0) return;
      if (sessionStorage.getItem(EXIT_INTENT_FLAG)) return;
      if (sessionStorage.getItem(LEAD_SUBMITTED_FLAG)) return;
      sessionStorage.setItem(EXIT_INTENT_FLAG, '1');
      setOpen(true);
      dataLayerPush('exit_intent_shown');
    }
    document.addEventListener('mouseleave', onLeave);
    return () => document.removeEventListener('mouseleave', onLeave);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    dataLayerPush('exit_intent_converted');
    if (address.trim()) {
      sessionStorage.setItem(PREFILL_ADDRESS_KEY, address.trim());
      window.dispatchEvent(new CustomEvent('prefill-address', { detail: address.trim() }));
    }
    setOpen(false);
    scrollToValuation();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fadeIn bg-[rgba(20,20,24,0.55)]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-md animate-fadeIn rounded-card bg-white p-7 shadow-2xl">
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-4 top-3 text-2xl leading-none text-mute-light hover:text-charcoal"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold text-charcoal">
          Wait — find out what your home is worth before you go
        </h2>
        <p className="mt-2 text-sm text-mute">Takes 60 seconds. No obligation. No spam.</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter your home address"
            className="w-full rounded-lg border border-line px-4 py-3 text-base focus:border-platinum-blue focus:outline-none focus:ring-1 focus:ring-platinum-blue"
          />
          <button
            type="submit"
            className="w-full rounded-pill bg-platinum-red px-6 py-3.5 text-base font-bold text-white hover:bg-platinum-redHover"
          >
            Show Me My Home Value →
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-mute-light">
          Free estimate. We&apos;ll never share your address.
        </p>
      </div>
    </div>
  );
}
