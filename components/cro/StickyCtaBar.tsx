'use client';

import * as React from 'react';
import { LEAD_SUBMITTED_FLAG } from '@/lib/clientAnalytics';
import { OPEN_VALUATION_EVENT } from '@/components/HeroValuation';

/**
 * Sticky CTA bar (Section 22.3). Appears once the visitor scrolls past the
 * hero; hidden once a lead has been submitted. Opens the shared valuation
 * modal (the page no longer has a separate on-page form to scroll to).
 */
export default function StickyCtaBar() {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (sessionStorage.getItem(LEAD_SUBMITTED_FLAG)) return;
    function onScroll() {
      if (sessionStorage.getItem(LEAD_SUBMITTED_FLAG)) {
        setShow(false);
        return;
      }
      setShow(window.scrollY > 700);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function openValuation() {
    window.dispatchEvent(new CustomEvent(OPEN_VALUATION_EVENT));
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-6px_24px_rgba(20,20,24,0.10)] backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <span className="hidden text-sm font-semibold text-charcoal sm:block">
          See what your home is worth — free, no obligation.
        </span>
        <button
          onClick={openValuation}
          className="min-h-[56px] w-full rounded-pill bg-platinum-red px-6 text-base font-bold text-white hover:bg-platinum-redHover sm:min-h-0 sm:w-auto sm:py-3"
        >
          Get My Free Home Value →
        </button>
      </div>
    </div>
  );
}
