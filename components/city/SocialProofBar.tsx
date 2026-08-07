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
 * outcome: verified sales and real Google review counts. Hidden below 10 sales
 * so a thin city page makes no claim at all rather than a weak one.
 */
export default function SocialProofBar({
  cityName,
  homesSold,
  googleReviewRating,
  googleReviewCount,
  topTestimonial,
}: SocialProofBarProps) {
  if (homesSold == null || homesSold < MIN_LOCAL_PROOF) return null;

  return (
    <section className="border-y border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-5 text-center sm:flex-row sm:justify-center sm:gap-8">
        <p className="text-sm font-bold text-charcoal">
          <span className="font-numeric text-platinum-red">{homesSold.toLocaleString()}</span>{' '}
          homes sold in {cityName} in the last 12 months.
        </p>
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
