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
    <section className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold text-brand-blue">
          Frequently Asked Questions About Selling in {cityName}, MI
        </h2>
        <dl className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <dt>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-semibold text-slate-800 hover:text-brand-blue"
                  >
                    <span>{item.question}</span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-2xl font-normal text-brand-blue"
                    >
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                </dt>
                {isOpen ? (
                  <dd className="pb-5 text-slate-600">{item.answer}</dd>
                ) : null}
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
