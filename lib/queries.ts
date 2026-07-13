/**
 * Server-side data loading for public pages (Section 4.2).
 * City page data is fetched at render time. Next.js ISR caches the rendered page.
 */
import { eq, and, or, desc, asc, sql, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db';
import {
  locations,
  marketStats,
  testimonials,
  neighborhoodLinks,
  trackingScripts,
  homePageMetrics,
  agents,
  closings,
  guides,
  offices,
  notificationSettings,
  googleReviews,
  idxListings,
  type Location,
  type MarketStat,
  type Testimonial,
  type NeighborhoodLink,
  type TrackingScript,
  type Guide,
} from '../drizzle/schema';
import { parseOfficeKeys } from './idxSync';
import { cityTileImage } from './cityImages';
import { getCityMarketStats, type CityMarketStats } from './idx';

export interface CityGoogleReview {
  id: number;
  quote: string;
  authorName: string;
  relativeTime: string | null;
  rating: number;
  photoUrl: string | null;
}

export interface CityPageData {
  location: Location;
  stats: MarketStat | null;
  recentSales: HomeRecentSale[];
  testimonials: Testimonial[];
  neighborhoodLinks: NeighborhoodLink[];
  trackingScripts: TrackingScript[];
  /** Cached Google reviews for this city (from its linked office, or pooled). */
  googleReviews: CityGoogleReview[];
  /** Star rating for the hero/social-proof bar (linked office, else manual). */
  reviewRating: number | null;
  reviewCount: number | null;
  /** IDX-derived market trend stats for this city's Market Report section. */
  idxMarketStats: CityMarketStats | null;
}

/** The mailing cities a location covers (falls back to its own short name). */
export function locationMatchCities(loc: { name: string; matchCities: string | null }): string[] {
  const list = (loc.matchCities ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [loc.name.split(',')[0].trim()];
}
export async function getActiveLocations(): Promise<Location[]> {
  try {
    return await db
      .select()
      .from(locations)
      .where(eq(locations.isActive, true))
      .orderBy(asc(locations.name));
  } catch (err) {
    // Tolerate a DB hiccup during build-time static generation; ISR fills in later.
    console.warn('[queries] getActiveLocations failed:', err);
    return [];
  }
}

export async function getLocationBySlug(slug: string): Promise<Location | null> {
  try {
    const rows = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[queries] getLocationBySlug failed:', err);
    return null;
  }
}

export async function getMarketStats(locationId: number): Promise<MarketStat | null> {
  try {
    const rows = await db
      .select()
      .from(marketStats)
      .where(eq(marketStats.locationId, locationId))
      .orderBy(desc(marketStats.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[queries] getMarketStats failed:', err);
    return null;
  }
}

/**
 * Cached Google reviews for a city page, plus the star rating/count to show in
 * the hero. Uses the location's linked office (`officeId`) when set; otherwise
 * falls back to a mix of all offices' reviews. The rating/count prefer the
 * linked office's live Google numbers, falling back to the manual per-location
 * fields that already drove the hero.
 */
async function getLocationReviews(location: Location): Promise<{
  reviews: CityGoogleReview[];
  rating: number | null;
  count: number | null;
}> {
  try {
    let placeIds: string[] = [];
    let officeRating: number | null = null;
    let officeCount: number | null = null;

    if (location.officeId != null) {
      const rows = await db
        .select({
          placeId: offices.googlePlaceId,
          rating: offices.googleReviewRating,
          count: offices.googleReviewCount,
        })
        .from(offices)
        .where(eq(offices.id, location.officeId))
        .limit(1);
      const o = rows[0];
      if (o?.placeId?.trim()) placeIds = [o.placeId.trim()];
      officeRating = o?.rating ?? null;
      officeCount = o?.count ?? null;
    } else {
      placeIds = await getOfficePlaceIds();
    }

    let reviews: CityGoogleReview[] = [];
    if (placeIds.length) {
      const rows = await db
        .select()
        .from(googleReviews)
        .where(inArray(googleReviews.placeId, placeIds))
        .orderBy(desc(googleReviews.reviewTime));
      reviews = rows
        .filter((r) => (r.rating ?? 0) >= 4 && (r.text ?? '').trim().length > 0)
        .slice(0, 6)
        .map((r) => ({
          id: r.id,
          quote: r.text ?? '',
          authorName: r.authorName ?? 'Google reviewer',
          relativeTime: r.relativeTime,
          rating: r.rating ?? 5,
          photoUrl: r.profilePhotoUrl,
        }));
    }

    return {
      reviews,
      rating: officeRating ?? location.googleReviewRating ?? null,
      count: officeCount ?? location.googleReviewCount ?? null,
    };
  } catch (err) {
    console.warn('[queries] getLocationReviews failed:', err);
    return {
      reviews: [],
      rating: location.googleReviewRating ?? null,
      count: location.googleReviewCount ?? null,
    };
  }
}

/**
 * Full city page payload. The page-level ISR configuration handles caching.
 */
export async function getCityPageData(slug: string): Promise<CityPageData | null> {
  const location = await getLocationBySlug(slug);
  if (!location || !location.isActive) return null;

  let stats: MarketStat | null = null;
  let sales: HomeRecentSale[] = [];
  let tms: Testimonial[] = [];
  let links: NeighborhoodLink[] = [];
  let scripts: TrackingScript[] = [];
  let idxMarketStats: CityMarketStats | null = null;
  let reviews: { reviews: CityGoogleReview[]; rating: number | null; count: number | null } = {
    reviews: [],
    rating: location.googleReviewRating ?? null,
    count: location.googleReviewCount ?? null,
  };
  try {
    [stats, sales, tms, links, scripts, reviews, idxMarketStats] = await Promise.all([
      getMarketStats(location.id),
      getCityRecentSales(locationMatchCities(location), 6),
      db
        .select()
        .from(testimonials)
        .where(and(eq(testimonials.locationId, location.id), eq(testimonials.isActive, true)))
        .orderBy(asc(testimonials.displayOrder)),
      db
        .select()
        .from(neighborhoodLinks)
        .where(eq(neighborhoodLinks.locationId, location.id))
        .orderBy(asc(neighborhoodLinks.displayOrder)),
      getTrackingScriptsForLocation(location.id),
      getLocationReviews(location),
      // Market Report stats keyed on the primary mailing city this page covers.
      getCityMarketStats(locationMatchCities(location)[0] ?? '').catch(() => null),
    ]);
  } catch (err) {
    console.warn('[queries] getCityPageData secondary fetch failed:', err);
  }

  const data: CityPageData = {
    location,
    stats,
    recentSales: sales,
    testimonials: tms,
    neighborhoodLinks: links,
    trackingScripts: scripts,
    googleReviews: reviews.reviews,
    reviewRating: reviews.rating,
    reviewCount: reviews.count,
    idxMarketStats,
  };

  return data;
}

/** Tracking scripts for a location plus any global (locationId null) scripts. */
export async function getTrackingScriptsForLocation(locationId: number): Promise<TrackingScript[]> {
  const all = await db
    .select()
    .from(trackingScripts)
    .where(eq(trackingScripts.isActive, true));
  return all.filter((s) => s.locationId === null || s.locationId === locationId);
}

export async function getHomePageMetrics() {
  try {
    const rows = await db.select().from(homePageMetrics).limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[queries] getHomePageMetrics failed:', err);
    return null;
  }
}

export interface HomepageAggregateStats {
  homesSold: number | null;
  closedVolume: number | null;
  localAgents: number | null;
  avgRating: number | null;
  reviewCount: number | null;
}

/** Aggregate, business-wide numbers for the homepage. All computed from data. */
export async function getHomepageAggregateStats(): Promise<HomepageAggregateStats> {
  try {
    const [metricsRow, idxRow, closingsRow, agentsRow, reviewRow] = await Promise.all([
      db.select().from(homePageMetrics).limit(1),
      // IDX office-closed deals (both sides) — the preferred source (§ intro).
      db
        .select({
          vol: sql<string | null>`sum(${idxListings.closePrice})`,
          cnt: sql<number>`count(*)::int`,
        })
        .from(idxListings)
        .where(sql`${idxListings.isOfficeListing} = true and ${idxListings.standardStatus} = 'Closed' and ${idxListings.closePrice} is not null`),
      db
        .select({
          vol: sql<string | null>`sum(${closings.salePrice})`,
          cnt: sql<number>`count(*)::int`,
        })
        .from(closings),
      db.select({ n: sql<number>`count(*)::int` }).from(agents),
      db
        .select({
          avg: sql<string | null>`avg(${locations.googleReviewRating})`,
          reviews: sql<string | null>`sum(${locations.googleReviewCount})`,
        })
        .from(locations)
        .where(sql`${locations.googleReviewRating} is not null`),
    ]);
    const idxCount = Number(idxRow[0]?.cnt ?? 0);
    const closingsCount = Number(closingsRow[0]?.cnt ?? 0);
    // Prefer IDX numbers once the feed carries office deals; else imported closings.
    const closedVolume =
      idxCount > 0 && idxRow[0]?.vol != null
        ? Number(idxRow[0].vol)
        : closingsRow[0]?.vol != null
          ? Number(closingsRow[0].vol)
          : null;
    const homesSold =
      metricsRow[0]?.totalHomesSold ??
      (idxCount > 0 ? idxCount : closingsCount > 0 ? closingsCount : null);
    const localAgents = Number(agentsRow[0]?.n ?? 0);
    const avgRating = reviewRow[0]?.avg != null ? Number(reviewRow[0].avg) : null;
    const reviewCount = reviewRow[0]?.reviews != null ? Number(reviewRow[0].reviews) : null;
    return { homesSold, closedVolume, localAgents, avgRating, reviewCount };
  } catch (err) {
    console.warn('[queries] getHomepageAggregateStats failed:', err);
    return { homesSold: null, closedVolume: null, localAgents: null, avgRating: null, reviewCount: null };
  }
}

export interface HomeRecentSale {
  id: number;
  address: string;
  soldPrice: number | null;
  daysOnMarket: number | null;
  closeDate: Date | null;
  photoUrl: string | null;
  cityName: string | null;
  /** IDX listing key when this sale is an IDX listing (→ links to a detail
   *  page); null for imported CSV closings, which have no detail page. */
  listingKey: string | null;
}

const TILE_TYPES = ['RS', 'CO'];
const TILE_SELECT = {
  id: closings.id,
  address: closings.address,
  soldPrice: closings.salePrice,
  daysOnMarket: closings.daysOnMarket,
  closeDate: closings.closeDate,
  photoUrl: closings.photoUrl,
  cityName: closings.city,
} as const;

/** Imported CSV closings have no IDX detail page, so their listingKey is null. */
function withNullListingKey<T extends Record<string, unknown>>(rows: T[]): (T & { listingKey: null })[] {
  return rows.map((r) => ({ ...r, listingKey: null }));
}

/** WHERE fragment: the closed listing is a sale, not a lease/rental. */
const idxNotLease = or(
  isNull(idxListings.propertyType),
  and(
    sql`lower(${idxListings.propertyType}) not like '%lease%'`,
    sql`lower(${idxListings.propertyType}) not like '%rent%'`,
  ),
);

/**
 * IDX-sourced recent sales — our own listing-side office deals (IDX spec intro:
 * recent sales now come from the MLS feed). Returns [] when the feed is not yet
 * populated / office keys unset, so callers fall back to imported closings.
 */
async function idxOfficeRecentSales(cities: string[] | null, limit: number): Promise<HomeRecentSale[]> {
  const keys = parseOfficeKeys();
  if (keys.length === 0) return [];
  try {
    // Listing side only: a RE/MAX Platinum office is the list or co-list office
    // (buyer-side deals are excluded from the "recently sold by us" showcase).
    // Leases are excluded so a closed rental never shows as a sale.
    const conds = [
      eq(idxListings.standardStatus, 'Closed'),
      isNotNull(idxListings.photoUrl),
      idxNotLease,
      or(inArray(idxListings.listOfficeKey, keys), inArray(idxListings.coListOfficeKey, keys)),
    ];
    if (cities && cities.length) {
      conds.push(or(...cities.map((c) => sql`lower(${idxListings.city}) = ${c.toLowerCase()}`)));
    }
    const rows = await db
      .select({
        id: idxListings.id,
        address: idxListings.address,
        soldPrice: idxListings.closePrice,
        daysOnMarket: idxListings.daysOnMarket,
        closeDate: idxListings.closeDate,
        photoUrl: idxListings.photoUrl,
        cityName: idxListings.city,
        listingKey: idxListings.listingKey,
      })
      .from(idxListings)
      .where(and(...conds))
      .orderBy(desc(idxListings.closeDate))
      .limit(limit);
    return rows.map((r) => ({ ...r, address: r.address ?? '' }));
  } catch (err) {
    console.warn('[queries] idxOfficeRecentSales failed:', err);
    return [];
  }
}

/**
 * Newest sales across ALL areas — the homepage tiles. Prefers our IDX office
 * deals; falls back to imported closings (list-side RS/CO) when the feed is empty.
 */
export async function getFeaturedRecentSales(limit = 6): Promise<HomeRecentSale[]> {
  try {
    const idx = await idxOfficeRecentSales(null, limit);
    if (idx.length) return idx;
    const rows = await db
      .select(TILE_SELECT)
      .from(closings)
      .where(and(eq(closings.agentRole, 'listing'), inArray(closings.propertyType, TILE_TYPES)))
      .orderBy(desc(closings.closeDate))
      .limit(limit);
    return withNullListingKey(rows);
  } catch (err) {
    console.warn('[queries] getFeaturedRecentSales failed:', err);
    return [];
  }
}

/** Newest sales for the mailing cities a location covers (IDX-first, closings fallback). */
export async function getCityRecentSales(cities: string[], limit = 6): Promise<HomeRecentSale[]> {
  if (cities.length === 0) return [];
  try {
    const idx = await idxOfficeRecentSales(cities, limit);
    if (idx.length) return idx;
    const cityConds = cities.map((c) => sql`lower(${closings.city}) = ${c.toLowerCase()}`);
    const rows = await db
      .select(TILE_SELECT)
      .from(closings)
      .where(
        and(
          eq(closings.agentRole, 'listing'),
          inArray(closings.propertyType, TILE_TYPES),
          or(...cityConds),
        ),
      )
      .orderBy(desc(closings.closeDate))
      .limit(limit);
    return withNullListingKey(rows);
  } catch (err) {
    console.warn('[queries] getCityRecentSales failed:', err);
    return [];
  }
}

export interface CityTile {
  slug: string;
  name: string;
  avgSalePrice: number | null;
  daysToSell: number | null;
  photoUrl: string | null;
}

/** Active cities with headline stats + a representative photo, for the homepage. */
export async function getCityTiles(): Promise<CityTile[]> {
  try {
    const locs = await db
      .select()
      .from(locations)
      .where(eq(locations.isActive, true))
      .orderBy(asc(locations.name));
    return await Promise.all(
      locs.map(async (l) => {
        const [stat] = await db
          .select({ avgSalePrice: marketStats.avgSalePrice, daysToSell: marketStats.daysToSell })
          .from(marketStats)
          .where(eq(marketStats.locationId, l.id))
          .limit(1);
        const cities = locationMatchCities(l);
        // 1) A configured blob asset for this city wins (admin-curated image);
        // 2) else the most-recent office-sale photo; 3) else a closings photo.
        let photoUrl: string | null = cityTileImage(l.slug);
        if (!photoUrl && cities.length > 0) {
          const idxSale = await idxOfficeRecentSales(cities, 1);
          photoUrl = idxSale[0]?.photoUrl ?? null;
          if (!photoUrl) {
            const cityConds = cities.map((c) => sql`lower(${closings.city}) = ${c.toLowerCase()}`);
            const [photo] = await db
              .select({ url: closings.photoUrl })
              .from(closings)
              .where(
                and(
                  eq(closings.agentRole, 'listing'),
                  inArray(closings.propertyType, TILE_TYPES),
                  sql`${closings.photoUrl} is not null`,
                  or(...cityConds),
                ),
              )
              .orderBy(desc(closings.closeDate))
              .limit(1);
            photoUrl = photo?.url ?? null;
          }
        }
        return {
          slug: l.slug,
          name: l.name,
          avgSalePrice: stat?.avgSalePrice ?? null,
          daysToSell: stat?.daysToSell ?? null,
          photoUrl,
        };
      }),
    );
  } catch (err) {
    console.warn('[queries] getCityTiles failed:', err);
    return [];
  }
}

/** Active downloadable guides assigned to a given page key (e.g. "home"). */
export async function getGuidesForPage(pageKey: string): Promise<Guide[]> {
  try {
    const rows = await db
      .select()
      .from(guides)
      .where(eq(guides.isActive, true))
      .orderBy(asc(guides.displayOrder));
    return rows.filter((g) => {
      try {
        const arr = JSON.parse(g.placement);
        return Array.isArray(arr) && arr.includes(pageKey);
      } catch {
        return false;
      }
    });
  } catch (err) {
    console.warn('[queries] getGuidesForPage failed:', err);
    return [];
  }
}

/** Featured testimonials across all locations (homepage). */
/** Unified testimonial for the homepage (manual and/or Google, one shape). */
export interface HomeTestimonial {
  id: string;
  quote: string;
  clientName: string;
  subLabel: string | null; // sale details/neighborhood, or "via Google · 2 months ago"
  rating: number; // 1-5 (manual defaults to 5)
  source: 'manual' | 'google';
  photoUrl: string | null;
}

/** Read the homepage testimonials source setting ('manual' | 'google' | 'both'). */
export async function getReviewSettings(): Promise<{
  source: 'manual' | 'google' | 'both';
}> {
  try {
    const rows = await db
      .select({ source: notificationSettings.testimonialSource })
      .from(notificationSettings)
      .limit(1);
    const source = (rows[0]?.source as 'manual' | 'google' | 'both') ?? 'manual';
    return { source: ['manual', 'google', 'both'].includes(source) ? source : 'manual' };
  } catch {
    return { source: 'manual' };
  }
}

/** Place IDs across all offices — reviews are fetched per Google Business Profile. */
async function getOfficePlaceIds(): Promise<string[]> {
  try {
    const rows = await db
      .select({ placeId: offices.googlePlaceId })
      .from(offices)
      .where(isNotNull(offices.googlePlaceId));
    return Array.from(
      new Set(rows.map((r) => r.placeId?.trim()).filter((p): p is string => !!p)),
    );
  } catch {
    return [];
  }
}

/**
 * Homepage testimonials, honoring the admin source toggle. 'both' interleaves
 * manual and Google reviews for variety. Google reviews are read from the cache
 * table (populated by the admin refresh), never fetched live here.
 */
export async function getHomeTestimonials(limit = 3): Promise<HomeTestimonial[]> {
  try {
    const { source } = await getReviewSettings();

    const manual: HomeTestimonial[] =
      source === 'google'
        ? []
        : (await getFeaturedTestimonials(limit + 2)).map((t) => ({
            id: `m${t.id}`,
            quote: t.quote,
            clientName: t.clientName,
            subLabel: t.saleDetails ?? t.neighborhood ?? null,
            rating: 5,
            source: 'manual' as const,
            photoUrl: t.photoUrl,
          }));

    let google: HomeTestimonial[] = [];
    const placeIds = source === 'manual' ? [] : await getOfficePlaceIds();
    if ((source === 'google' || source === 'both') && placeIds.length) {
      const rows = await db
        .select()
        .from(googleReviews)
        .where(inArray(googleReviews.placeId, placeIds))
        .orderBy(desc(googleReviews.reviewTime));
      google = rows
        .filter((r) => (r.rating ?? 0) >= 4 && (r.text ?? '').trim().length > 0)
        .map((r) => ({
          id: `g${r.id}`,
          quote: r.text ?? '',
          clientName: r.authorName ?? 'Google reviewer',
          subLabel: r.relativeTime ? `via Google · ${r.relativeTime}` : 'via Google',
          rating: r.rating ?? 5,
          source: 'google' as const,
          photoUrl: r.profilePhotoUrl,
        }));
    }

    let combined: HomeTestimonial[];
    if (source === 'manual') combined = manual;
    else if (source === 'google') combined = google;
    else {
      combined = [];
      const max = Math.max(manual.length, google.length);
      for (let i = 0; i < max; i += 1) {
        if (manual[i]) combined.push(manual[i]);
        if (google[i]) combined.push(google[i]);
      }
    }
    return combined.slice(0, limit);
  } catch (err) {
    console.warn('[queries] getHomeTestimonials failed:', err);
    return [];
  }
}

export async function getFeaturedTestimonials(limit = 3): Promise<Testimonial[]> {
  try {
    const featured = await db
      .select()
      .from(testimonials)
      .where(and(eq(testimonials.isActive, true), eq(testimonials.isFeatured, true)))
      .limit(limit);
    if (featured.length >= 2) return featured;
    // Fall back to any active testimonials if not enough are flagged featured.
    return await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.isActive, true))
      .orderBy(asc(testimonials.displayOrder))
      .limit(limit);
  } catch (err) {
    console.warn('[queries] getFeaturedTestimonials failed:', err);
    return [];
  }
}
