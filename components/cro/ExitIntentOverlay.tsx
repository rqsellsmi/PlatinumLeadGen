'use client';

import * as React from 'react';
import { dataLayerPush, EXIT_INTENT_FLAG, LEAD_SUBMITTED_FLAG } from '@/lib/clientAnalytics';
import { OPEN_VALUATION_EVENT } from '@/components/HeroValuation';

/**
 * Exit-intent overlay (Section 22.2). Desktop only. Triggers on mouseleave
 * toward the browser chrome (clientY <= 0). Once per session; not shown if a
 * lead was already submitted. The address handoff goes to the main valuation
 * form via a custom event.
 *
 * The address field runs the same Google Places autocomplete as the hero and
 * modal forms, so it auto-suggests as the visitor types and hands off the
 * resolved address + coordinates. The Maps JS is loaded once by HeroValuation
 * (present on every public page), so by the time exit-intent fires it's ready.
 */
export default function ExitIntentOverlay() {
  const [open, setOpen] = React.useState(false);
  const [address, setAddress] = React.useState('');
  const placeRef = React.useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const inputRef = React.useRef<HTMLInputElement>(null);

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

  // Attach Places autocomplete once the overlay is open and Maps is ready. Maps
  // is loaded by HeroValuation on the same page; retry briefly in case the
  // visitor bolts before the script finishes.
  React.useEffect(() => {
    if (!open) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function tryAttach() {
      const places = window.google?.maps?.places;
      const el = inputRef.current;
      if (!places || !el) {
        if (tries++ < 20) timer = setTimeout(tryAttach, 150);
        return;
      }
      const ac = new places.Autocomplete(el, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address', 'geometry'],
      });
      ac.addListener('place_changed', () => {
        const sel = ac.getPlace();
        const formatted = sel.formatted_address;
        const loc = sel.geometry?.location;
        if (!formatted) return;
        setAddress(formatted);
        placeRef.current = {
          lat: loc ? loc.lat() : null,
          lng: loc ? loc.lng() : null,
        };
      });
    }
    tryAttach();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    dataLayerPush('exit_intent_converted');
    setOpen(false);
    const addr = address.trim();
    window.dispatchEvent(
      new CustomEvent(OPEN_VALUATION_EVENT, {
        detail: addr
          ? { address: addr, propertyLat: placeRef.current.lat, propertyLng: placeRef.current.lng }
          : {},
      }),
    );
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
            ref={inputRef}
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              // Typing after a selection invalidates the resolved coordinates.
              placeRef.current = { lat: null, lng: null };
            }}
            autoComplete="off"
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
