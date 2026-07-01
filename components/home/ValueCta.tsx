'use client';

import { OPEN_VALUATION_EVENT } from '@/components/HeroValuation';

/** Blue "ready to know your home's value" band that opens the valuation modal. */
export default function ValueCta() {
  return (
    <section className="bg-platinum-blue">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
        <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Ready to know your home&apos;s value?
        </h2>
        <p className="mt-3 text-white/90">Get a free, no-obligation estimate in under a minute.</p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_VALUATION_EVENT))}
          className="mt-6 inline-flex items-center justify-center rounded-pill bg-white px-8 py-3.5 text-base font-bold text-platinum-blue transition-colors hover:bg-white/90"
        >
          Get My Free Home Value →
        </button>
      </div>
    </section>
  );
}
