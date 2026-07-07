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
  /**
   * null on success; a human-readable reason on failure. Surfaced in the admin
   * so operators can see WHY a fetch returned nothing (Google redacts thrown
   * errors in production). Common values map to Google's `status` +
   * `error_message` (e.g. REQUEST_DENIED for a referrer-restricted or
   * legacy-API-disabled key).
   */
  error: string | null;
}

function key(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null;
}

function fail(error: string): GooglePlaceDetails {
  return { reviews: [], rating: null, reviewCount: null, error };
}

/**
 * Fetch a place's overall rating/count plus up to 5 reviews for a Place ID.
 * Never throws — returns an `error` string on failure so a bad Place ID or a
 * key/API problem for one office is reported without breaking the batch.
 */
export async function fetchGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
  const k = key();
  if (!k) return fail('No GOOGLE_MAPS_API_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) is set on this deployment.');
  if (!placeId) return fail('No Place ID.');
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'reviews,rating,user_ratings_total');
    url.searchParams.set('reviews_sort', 'newest');
    url.searchParams.set('key', k);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return fail(`Google HTTP ${res.status}.`);
    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
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
    // Anything other than OK is a real failure we want to see verbatim.
    if (data.status !== 'OK' || !data.result) {
      const status = data.status ?? 'UNKNOWN';
      return fail(data.error_message ? `${status}: ${data.error_message}` : status);
    }
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
      error: null,
    };
  } catch (err) {
    console.error('[googleReviews] fetch failed:', err);
    return fail(err instanceof Error ? err.message : 'Network error calling Google.');
  }
}
