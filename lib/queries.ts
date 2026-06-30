/**
 * Server-side data loading for public pages (Section 4.2).
 * City page data is fetched at render time. Next.js ISR caches the rendered page.
 */
import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from './db';
import {
  locations,
  marketStats,
  recentSales,
  testimonials,
  neighborhoodLinks,
  trackingScripts,
  homePageMetrics,
  type Location,
  type MarketStat,
  type RecentSale,
  type Testimonial,
  type NeighborhoodLink,
  type TrackingScript,
} from '../drizzle/schema';

export interface CityPageData {
  location: Location;
  stats: MarketStat | null;
  recentSales: RecentSale[];
  testimonials: Testimonial[];
  neighborhoodLinks: NeighborhoodLink[];
  trackingScripts: TrackingScript[];
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
  let sales: RecentSale[] = [];
  let tms: Testimonial[] = [];
  let links: NeighborhoodLink[] = [];
  let scripts: TrackingScript[] = [];
  try {
    [stats, sales, tms, links, scripts] = await Promise.all([
      getMarketStats(location.id),
      db
        .select()
        .from(recentSales)
        .where(eq(recentSales.locationId, location.id))
        .orderBy(asc(recentSales.displayOrder), desc(recentSales.closeDate))
        .limit(6),
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
