import type { Testimonial } from '@/drizzle/schema';

interface SocialProofBarProps {
  cityName: string;
  socialProofCount: number;
  googleReviewRating: number | null;
  googleReviewCount: number | null;
  topTestimonial: Testimonial | null;
}

/**
 * Social proof bar (Section 4.3 #2). Only shown when socialProofCount >= 10.
 * Shows homeowners served, optional star rating, and one pull-quote.
 */
export default function SocialProofBar({
  cityName,
  socialProofCount,
  googleReviewRating,
  googleReviewCount,
  topTestimonial,
}: SocialProofBarProps) {
  if (socialProofCount < 10) return null;

  return (
    <section className="border-y border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-5 text-center sm:flex-row sm:justify-center sm:gap-8">
        <p className="text-sm font-bold text-charcoal">
          <span className="font-numeric text-platinum-red">{socialProofCount.toLocaleString()}</span>{' '}
          {cityName} homeowners served.
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
