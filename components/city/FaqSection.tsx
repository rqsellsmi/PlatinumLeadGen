'use client';

import * as React from 'react';
import type { FaqItem } from '@/lib/seo';

interface FaqSectionProps {
  faq: FaqItem[];
  cityName: string;
}

/** Accordion of city-specific FAQs. JSON-LD is injected by the page, not here. */
export default function FaqSection({ faq, cityName }: FaqSectionProps) {
  const items = faq.slice(0, 6);
  const [open, setOpen] = React.useState<number | null>(0);
  if (!items.length) return null;

  return (
    <section className="bg-cream">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
        <h2 className="text-center text-2xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
          Frequently Asked Questions About Selling in {cityName}, MI
        </h2>
        <div className="mt-12 flex flex-col gap-3">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="overflow-hidden rounded-card border border-line bg-white">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-lg font-bold text-charcoal"
                >
                  <span>{item.question}</span>
                  <span aria-hidden className="shrink-0 text-2xl font-normal text-platinum-red">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen ? (
                  <div className="px-6 pb-6 leading-relaxed text-mute">{item.answer}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
