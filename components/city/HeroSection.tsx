import HeroValuation from '@/components/HeroValuation';
import HeroBackdrop from '@/components/HeroBackdrop';
import { HERO_IMAGES } from '@/lib/heroImages';

interface HeroSectionProps {
  headline: string;
  subheadline: string;
  cityName: string;
  /** Location slug + page variant for the in-hero valuation flow. */
  locationSlug: string;
  pageVariant?: 'seo' | 'ads';
  /** Optional eyebrow shown above the H1 (e.g. "Brighton, Michigan"). */
  eyebrow?: string;
  /** Optional trust signals rendered under the address form. */
  rating?: number | null;
  reviewCount?: number | null;
  homesSold?: number | null;
}

/**
 * "Bold" hero (design mockup default): a full-bleed home photo with a dark
 * left-to-right gradient, an eyebrow, big headline, and an inline address
 * capture that hands off to the single valuation form. Server-rendered so the
 * hero image is a priority LCP asset with no layout shift.
 */
export default function HeroSection({
  headline,
  subheadline,
  cityName,
  locationSlug,
  pageVariant = 'seo',
  eyebrow,
  rating,
  reviewCount,
  homesSold,
}: HeroSectionProps) {
  return (
    <section className="relative isolate flex min-h-[560px] items-center px-5 py-16 sm:px-8 lg:min-h-[calc(86vh)] lg:px-12">
      <HeroBackdrop images={HERO_IMAGES} alt={`Homes for sale in ${cityName}`} />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-r from-[rgba(20,20,24,0.78)] via-[rgba(20,20,24,0.55)] to-[rgba(20,20,24,0.25)]"
      />
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-[680px] lg:max-w-[760px]">
          {eyebrow ? (
            <p className="mb-5 text-[13px] font-bold uppercase tracking-[0.14em] text-white/90">
              {eyebrow} · Free Home Valuation
            </p>
          ) : null}
          <h1 className="text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/90 sm:text-xl">
            {subheadline}
          </p>
          <div className="mt-8">
            <HeroValuation
              locationSlug={locationSlug}
              cityName={cityName}
              pageVariant={pageVariant}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold text-white">
            {rating != null ? (
              <span className="flex items-center gap-1.5">
                <span className="text-platinum-red" aria-hidden>
                  ★
                </span>
                {rating.toFixed(1)}
                {reviewCount != null ? ` · ${reviewCount.toLocaleString()}+ reviews` : ''}
              </span>
            ) : null}
            {homesSold ? (
              <span className="text-white/90">{homesSold.toLocaleString()}+ homes sold</span>
            ) : null}
            <span className="text-white/90">Free · No obligation</span>
            <a
              href="#recent-sales"
              className="font-bold text-white underline decoration-1 underline-offset-4"
            >
              See recent sales →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
