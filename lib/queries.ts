/**
 * Server-side data loading for public pages (Section 4.2).
 * City page data is fetched at render time. Next.js ISR caches the rendered page.
 */
import { eq, and, or, desc, asc, sql, inArray } from 'drizzle-orm';
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
  type Location,
  type MarketStat,
  type Testimonial,
  type NeighborhoodLink,
  type TrackingScript,
  type Guide,
} from '../drizzle/schema';

export interface CityPageData {
  location: Location;
  stats: MarketStat | null;
  recentSales: HomeRecentSale[];
  testimonials: Testimonial[];
  neighborhoodLinks: NeighborhoodLink[];
  trackingScripts: TrackingScript[];
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
  try {
    [stats, sales, tms, links, scripts] = await Promise.all([
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
    const [metricsRow, closingsRow, agentsRow, reviewRow] = await Promise.all([
      db.select().from(homePageMetrics).limit(1),
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
    const closedVolume = closingsRow[0]?.vol != null ? Number(closingsRow[0].vol) : null;
    const closingsCount = Number(closingsRow[0]?.cnt ?? 0);
    const homesSold = metricsRow[0]?.totalHomesSold ?? (closingsCount > 0 ? closingsCount : null);
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

/**
 * Newest list-side (RS/CO) sales across ALL areas — the homepage tiles.
 * Sourced straight from imported closings; photos come from closings.photoUrl.
 */
export async function getFeaturedRecentSales(limit = 6): Promise<HomeRecentSale[]> {
  try {
    return await db
      .select(TILE_SELECT)
      .from(closings)
      .where(and(eq(closings.agentRole, 'listing'), inArray(closings.propertyType, TILE_TYPES)))
      .orderBy(desc(closings.closeDate))
      .limit(limit);
  } catch (err) {
    console.warn('[queries] getFeaturedRecentSales failed:', err);
    return [];
  }
}

/** Newest list-side (RS/CO) sales for the mailing cities a location covers. */
export async function getCityRecentSales(cities: string[], limit = 6): Promise<HomeRecentSale[]> {
  if (cities.length === 0) return [];
  try {
    const cityConds = cities.map((c) => sql`lower(${closings.city}) = ${c.toLowerCase()}`);
    return await db
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
        let photoUrl: string | null = null;
        if (cities.length > 0) {
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
