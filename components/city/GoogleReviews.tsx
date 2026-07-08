import Image from 'next/image';
import type { CityGoogleReview } from '@/lib/queries';

interface GoogleReviewsProps {
  reviews: CityGoogleReview[];
  cityName: string;
  rating: number | null;
  reviewCount: number | null;
}

/**
 * Verified Google reviews for a city page, sourced from the location's linked
 * office's Google Business Profile (cached in google_reviews). Renders nothing
 * when there are fewer than 2 — Google's ToS requires attribution and unmodified
 * text, which the "via Google" label and verbatim quote satisfy.
 */
export default function GoogleReviews({ reviews, cityName, rating, reviewCount }: GoogleReviewsProps) {
  if (reviews.length < 2) return null;

  return (
    <section className="bg-offwhite">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
            Verified Google Reviews
          </h2>
          {rating != null ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
              <span className="text-warning" aria-hidden>
                {'★'.repeat(Math.round(rating))}
              </span>
              {rating.toFixed(1)}
              {reviewCount != null ? (
                <span className="text-mute-light">({reviewCount.toLocaleString()} reviews)</span>
              ) : null}
              <span className="text-mute-light">· via Google</span>
            </p>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-mute">
          What {cityName} homeowners say about RE/MAX Platinum on Google.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => (
            <figure key={r.id} className="flex flex-col rounded-xl bg-white p-9 shadow-sm">
              <div className="mb-4 flex gap-0.5 text-warning" aria-hidden>
                {'★★★★★'.split('').map((s, i) => (
                  <span key={i} className={i < Math.round(r.rating) ? '' : 'text-mute-lighter'}>
                    {s}
                  </span>
                ))}
              </div>
              <blockquote className="flex-1">
                <p className="font-serif text-lg leading-relaxed text-charcoal line-clamp-6">
                  &ldquo;{r.quote}&rdquo;
                </p>
              </blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                {r.photoUrl ? (
                  <Image
                    src={r.photoUrl}
                    alt={r.authorName}
                    width={44}
                    height={44}
                    loading="lazy"
                    unoptimized
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : null}
                <div>
                  <p className="font-bold text-charcoal">{r.authorName}</p>
                  <p className="text-sm text-mute-light">
                    {r.relativeTime ? `${r.relativeTime} · ` : ''}via Google
                  </p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
