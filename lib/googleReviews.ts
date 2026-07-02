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

function key(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null;
}

/** Fetch up to 5 reviews for a Place ID. */
export async function fetchGooglePlaceReviews(placeId: string): Promise<GoogleReview[]> {
  const k = key();
  if (!k || !placeId) return [];
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'reviews');
    url.searchParams.set('reviews_sort', 'newest');
    url.searchParams.set('key', k);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      status?: string;
      result?: {
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
    if (data.status !== 'OK' || !Array.isArray(data.result?.reviews)) return [];
    return data.result!.reviews!.map((r) => ({
      authorName: r.author_name ?? null,
      rating: typeof r.rating === 'number' ? r.rating : null,
      text: r.text ?? null,
      relativeTime: r.relative_time_description ?? null,
      profilePhotoUrl: r.profile_photo_url ?? null,
      reviewTime: typeof r.time === 'number' ? r.time : null,
    }));
  } catch (err) {
    console.error('[googleReviews] fetch failed:', err);
    return [];
  }
}
