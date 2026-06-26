/**
 * Server-side data loading for public pages (Section 4.2).
 * City page data is fetched at render time and cached in Upstash.
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
import { getCached, setCached, locationCacheKey } from './redis';

export interface CityPageData {
  location: Location;
  stats: MarketStat | null;
  recentSales: RecentSale[];
  testimonials: Testimonial[];
  neighborhoodLinks: NeighborhoodLink[];
  trackingScripts: TrackingScript[];
}

export async function getActiveLocations(): Promise<Location[]> {
  return db.select().from(locations).where(eq(locations.isActive, true)).orderBy(asc(locations.name));
}

export async function getLocationBySlug(slug: string): Promise<Location | null> {
  const rows = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getMarketStats(locationId: number): Promise<MarketStat | null> {
  const rows = await db
    .select()
    .from(marketStats)
    .where(eq(marketStats.locationId, locationId))
    .orderBy(desc(marketStats.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Full city page payload, cached in Upstash for the ISR window.
 * Cache stores a serialized snapshot; dates are revived on read.
 */
export async function getCityPageData(slug: string): Promise<CityPageData | null> {
  const cacheKey = locationCacheKey(slug);
  const cached = await getCached<CityPageData>(cacheKey);
  if (cached) return reviveDates(cached);

  const location = await getLocationBySlug(slug);
  if (!location || !location.isActive) return null;

  const [stats, sales, tms, links, scripts] = await Promise.all([
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

  const data: CityPageData = {
    location,
    stats,
    recentSales: sales,
    testimonials: tms,
    neighborhoodLinks: links,
    trackingScripts: scripts,
  };

  await setCached(cacheKey, data);
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
  const rows = await db.select().from(homePageMetrics).limit(1);
  return rows[0] ?? null;
}

/** Featured testimonials across all locations (homepage). */
export async function getFeaturedTestimonials(limit = 3): Promise<Testimonial[]> {
  const featured = await db
    .select()
    .from(testimonials)
    .where(and(eq(testimonials.isActive, true), eq(testimonials.isFeatured, true)))
    .limit(limit);
  if (featured.length >= 2) return featured;
  // Fall back to any active testimonials if not enough are flagged featured.
  return db
    .select()
    .from(testimonials)
    .where(eq(testimonials.isActive, true))
    .orderBy(asc(testimonials.displayOrder))
    .limit(limit);
}

/** Revive Date fields after a JSON round-trip through Redis. */
function reviveDates(data: CityPageData): CityPageData {
  const toDate = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    ...data,
    location: { ...data.location, updatedAt: toDate(data.location.updatedAt) as Date, createdAt: toDate(data.location.createdAt) as Date },
    recentSales: data.recentSales.map((s) => ({ ...s, closeDate: toDate(s.closeDate), createdAt: toDate(s.createdAt) as Date })),
  };
}
