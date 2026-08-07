import type { Testimonial } from '@/drizzle/schema';
import { MIN_LOCAL_PROOF } from '@/lib/idx';

interface SocialProofBarProps {
  cityName: string;
  /**
   * VERIFIED transactions in the last 12 months (market_stats / IDX office
   * deals). Never a lead or form-submission count — see D2. The bar previously
   * took `socialProofCount`, which was incremented once per form submit and
   * displayed as "N homeowners served".
   */
  homesSold: number | null;
  googleReviewRating: number | null;
  googleReviewCount: number | null;
  topTestimonial: Testimonial | null;
}

/**
 * Social proof bar (Section 4.3 #2). Every figure here must be backed by a real
 * outcome: real Google review counts and a real client quote.
 *
 * NO LONGER PRINTS THE SALES COUNT. MarketStatsBar, immediately below this, has a
 * dedicated "Homes Sold — Last 12 Months" tile for exactly that number, so this
 * bar was restating it a few pixels earlier. It still gates on `homesSold`
 * though: the sales floor is what earns the right to make ANY local claim here,
 * and a city we have barely worked should stay quiet rather than lead with a
 * lone review star.
 */
export default function SocialProofBar({
  cityName,
  homesSold,
  googleReviewRating,
  googleReviewCount,
  topTestimonial,
}: SocialProofBarProps) {
  if (homesSold == null || homesSold < MIN_LOCAL_PROOF) return null;
  // Nothing left to say once the sales sentence moved to the stats bar.
  if (googleReviewRating == null && !topTestimonial) return null;

  return (
    <section className="border-y border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-5 text-center sm:flex-row sm:justify-center sm:gap-8">
        {googleReviewRating != null ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
            <span className="text-warning" aria-hidden>
              {'★'.repeat(Math.round(googleReviewRating))}
            </span>
            {googleReviewRating.toFixed(1)}
            {googleReviewCount != null ? (
              <span className="text-mute-light">({googleReviewCount} reviews)</span>
            ) : null}
          </p>
        ) : null}
        {topTestimonial ? (
          <p className="max-w-md text-sm italic text-mute">
            &ldquo;{topTestimonial.quote.slice(0, 120)}
            {topTestimonial.quote.length > 120 ? '…' : ''}&rdquo;
          </p>
        ) : null}
      </div>
    </section>
  );
}
