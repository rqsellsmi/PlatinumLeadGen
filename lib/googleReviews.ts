/**
 * Google Places reviews fetch. The Places Details API returns up to 5 reviews
 * for a place. We fetch them here (admin-triggered) and cache the rows in the
 * google_reviews table so public pages never call the paid API directly.
 *
 * Uses GOOGLE_MAPS_API_KEY (server key with the Places API enabled), falling
 * back to the public Maps key. Returns [] on any failure.
 *
 * NOTE (Google ToS): reviews must be shown with attribution and not modified;
 * cache no longer than ~30 days. The UI labels these "via Google".
 */

export interface GoogleReview {
  authorName: string | null;
  rating: number | null;
  text: string | null;
  relativeTime: string | null;
  profilePhotoUrl: string | null;
  reviewTime: number | null; // unix seconds
}

export interface GooglePlaceDetails {
  reviews: GoogleReview[];
  /** The place's overall star rating (e.g. 4.9), or null if unavailable. */
  rating: number | null;
  /** Total number of ratings for the place, or null if unavailable. */
  reviewCount: number | null;
}

const EMPTY: GooglePlaceDetails = { reviews: [], rating: null, reviewCount: null };

function key(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null;
}

/**
 * Fetch a place's overall rating/count plus up to 5 reviews for a Place ID.
 * Returns EMPTY on any failure so a bad/expired Place ID for one office never
 * breaks the batch refresh across the others.
 */
export async function fetchGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
  const k = key();
  if (!k || !placeId) return EMPTY;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'reviews,rating,user_ratings_total');
    url.searchParams.set('reviews_sort', 'newest');
    url.searchParams.set('key', k);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as {
      status?: string;
      result?: {
        rating?: number;
        user_ratings_total?: number;
        reviews?: Array<{
          author_name?: string;
          rating?: number;
          text?: string;
          relative_time_description?: string;
          profile_photo_url?: string;
          time?: number;
        }>;
      };
    };
    if (data.status !== 'OK' || !data.result) return EMPTY;
    const reviews = Array.isArray(data.result.reviews)
      ? data.result.reviews.map((r) => ({
          authorName: r.author_name ?? null,
          rating: typeof r.rating === 'number' ? r.rating : null,
          text: r.text ?? null,
          relativeTime: r.relative_time_description ?? null,
          profilePhotoUrl: r.profile_photo_url ?? null,
          reviewTime: typeof r.time === 'number' ? r.time : null,
        }))
      : [];
    return {
      reviews,
      rating: typeof data.result.rating === 'number' ? data.result.rating : null,
      reviewCount: typeof data.result.user_ratings_total === 'number' ? data.result.user_ratings_total : null,
    };
  } catch (err) {
    console.error('[googleReviews] fetch failed:', err);
    return EMPTY;
  }
}
