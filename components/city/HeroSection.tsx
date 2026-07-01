import Image from 'next/image';

interface HeroSectionProps {
  headline: string;
  subheadline: string;
  cityName: string;
  /** Optional eyebrow shown above the H1 (e.g. "Brighton, Michigan"). */
  eyebrow?: string;
}

/**
 * "Warm Split" hero (Section 15.4 recommended): cream panel with text on one
 * side, photo on the other. Fully server-rendered, no layout shift, not
 * lazy-loaded. CTAs scroll to the single valuation form (#valuation).
 */
export default function HeroSection({ headline, subheadline, cityName, eyebrow }: HeroSectionProps) {
  return (
    <section className="bg-cream">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-stretch gap-0 md:grid-cols-2">
        <div className="flex flex-col justify-center px-6 py-14 sm:px-10 sm:py-20">
          {eyebrow ? (
            <p className="font-serif text-lg italic text-platinum-blue">{eyebrow}</p>
          ) : null}
          <h1 className="mt-2 text-3xl font-extrabold leading-[1.1] tracking-tight text-charcoal sm:text-5xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-mute">{subheadline}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#valuation"
              className="inline-flex items-center justify-center rounded-pill bg-platinum-red px-8 py-3.5 text-base font-bold text-white transition-colors hover:bg-platinum-redHover"
            >
              Get My Free Home Value →
            </a>
            <a
              href="#recent-sales"
              className="inline-flex items-center justify-center rounded-pill border-[1.5px] border-charcoal/30 px-8 py-3.5 text-base font-bold text-charcoal transition-colors hover:border-charcoal"
            >
              See Recent Sales in {cityName}
            </a>
          </div>
        </div>
        <div className="relative min-h-[280px] md:min-h-full">
          <Image
            src="/assets/hero-home.jpg"
            alt={`Homes for sale in ${cityName}`}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      </div>
    </section>
  );
}
