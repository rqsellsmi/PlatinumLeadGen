'use client';

import * as React from 'react';
import { scrollToValuation, LEAD_SUBMITTED_FLAG } from '@/lib/clientAnalytics';

/**
 * Sticky CTA bar (Section 22.3). Appears once the valuation form scrolls out of
 * view; hidden when the form is visible or once a lead has been submitted.
 * Watches the #valuation element with IntersectionObserver.
 */
export default function StickyCtaBar() {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (sessionStorage.getItem(LEAD_SUBMITTED_FLAG)) return;
    const target = document.getElementById('valuation');
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (sessionStorage.getItem(LEAD_SUBMITTED_FLAG)) {
          setShow(false);
          return;
        }
        // Show when the form is NOT in view (and we've scrolled past its top).
        setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-6px_24px_rgba(20,20,24,0.10)] backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <span className="hidden text-sm font-semibold text-charcoal sm:block">
          See what your home is worth — free, no obligation.
        </span>
        <button
          onClick={scrollToValuation}
          className="min-h-[56px] w-full rounded-pill bg-platinum-red px-6 text-base font-bold text-white hover:bg-platinum-redHover sm:min-h-0 sm:w-auto sm:py-3"
        >
          Get My Free Home Value →
        </button>
      </div>
    </div>
  );
}
