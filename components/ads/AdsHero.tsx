import ValuationForm from '@/components/city/ValuationForm';

const TRUST_BULLETS = [
  'Free — no obligation',
  'Instant estimate from real sales',
  'Local RE/MAX expert reviews your results',
];

/**
 * PPC hero with inline form (Section 20.3 #2). Desktop: headline + trust bullets
 * left, form right. Mobile: stacked. The form IS the conversion point.
 */
export default function AdsHero({
  headline,
  cityName,
  locationSlug,
}: {
  headline: string;
  cityName: string;
  locationSlug: string;
}) {
  return (
    <section className="bg-cream">
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-8 px-4 py-10 md:grid-cols-2 md:py-14">
        <div>
          <h1 className="text-3xl font-extrabold leading-[1.1] tracking-tight text-charcoal sm:text-4xl">
            {headline}
          </h1>
          <ul className="mt-6 space-y-3">
            {TRUST_BULLETS.map((b) => (
              <li key={b} className="flex items-start gap-2 text-base font-semibold text-charcoal">
                <span className="mt-0.5 text-success" aria-hidden>
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div className="-mx-4 md:mx-0">
          {/* Reuse the single valuation form; pageVariant tags the lead as ads. */}
          <ValuationForm locationSlug={locationSlug} cityName={cityName} pageVariant="ads" />
        </div>
      </div>
    </section>
  );
}
