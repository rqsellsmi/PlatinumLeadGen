'use client';

import Link from 'next/link';
import Logo from '@/components/Logo';
import HeroValuation, { OPEN_VALUATION_HEADER } from '@/components/HeroValuation';

/** Shared public site header (Section 15). The "Free Home Value" button opens
 *  the valuation pop-up from ANY page: a modal-only HeroValuation is mounted
 *  here (present on every page) and the button dispatches its open event. */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <Logo variant="blue" width={140} priority />
        <nav className="flex items-center gap-7 text-sm font-semibold text-charcoal">
          <Link href="/" className="hidden hover:text-platinum-blue sm:inline">
            Home
          </Link>
          <Link href="/sell" className="hidden hover:text-platinum-blue sm:inline">
            Cities
          </Link>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_VALUATION_HEADER))}
            className="rounded-pill bg-platinum-red px-5 py-2 text-white hover:bg-platinum-redHover"
          >
            Free Home Value
          </button>
        </nav>
      </div>
      {/* Global valuation modal — no inline box; opened by the button above via
          its own event so it never double-opens with a page's inline hero. */}
      <HeroValuation modalOnly openEvent={OPEN_VALUATION_HEADER} buttonLabel="" />
    </header>
  );
}
