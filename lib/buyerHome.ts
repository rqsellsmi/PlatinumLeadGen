/**
 * Buyer homepage data: recent active listings (service-area) and the "browse by
 * city" tiles (near-an-office ∧ most-active, minus the admin exclusion list).
 * The ranking/exclusion logic is the pure `rankBuyerCityTiles` in
 * `lib/listingSearch.ts` (unit-tested); this module does the DB reads.
 */
import { and, or, eq, inArray, isNotNull, sql, asc, desc } from 'drizzle-orm';
import { db } from './db';
import { idxListings, offices, notificationSettings } from '../drizzle/schema';
import { canDisplay, notLease, notCommercial, gateAddress, approxMiles, type IdxCard } from './idx';
import {
  FOR_SALE_STATUSES,
  rankBuyerCityTiles,
  parseExcludedCities,
  type CityActiveStat,
  type OfficePoint,
} from './listingSearch';

const SERVICE_AREA_MILES = 20;
const DEFAULT_EXCLUDED = ['Flint', 'Pontiac', 'Detroit'];

const forSaleWhere = and(
  inArray(idxListings.standardStatus, FOR_SALE_STATUSES as unknown as string[]),
  canDisplay,
  notLease,
  notCommercial, // homes only — exclude commercial/business categories
);

/** Active offices with coordinates (for the 20-mile service-area geometry). */
export async function getOfficePoints(): Promise<OfficePoint[]> {
  try {
    const rows = await db
      .select({ lat: offices.latitude, lng: offices.longitude })
      .from(offices)
      .where(eq(offices.isActive, true));
    return rows;
  } catch (err) {
    console.warn('[buyerHome] getOfficePoints failed:', err);
    return [];
  }
}

/** The admin-editable buyer-tile exclusion list (defaults when unset). */
export async function getBuyerExcludedCities(): Promise<string[]> {
  try {
    const [row] = await db
      .select({ raw: notificationSettings.buyerExcludedCities })
      .from(notificationSettings)
      .limit(1);
    const list = parseExcludedCities(row?.raw);
    return list.length ? list : DEFAULT_EXCLUDED;
  } catch (err) {
    console.warn('[buyerHome] getBuyerExcludedCities failed:', err);
    return DEFAULT_EXCLUDED;
  }
}

/**
 * The 9 most-recent active listings in the service area (within 20 mi of an
 * office). "Most recent" is approximated by days-on-market asc (no list-date
 * column yet — see spec §6). Falls back to newest overall if offices have no
 * coordinates set.
 */
export async function getRecentActiveListings(limit = 9): Promise<IdxCard[]> {
  try {
    const [pool, officePts] = await Promise.all([
      db
        .select()
        .from(idxListings)
        .where(forSaleWhere)
        .orderBy(asc(idxListings.daysOnMarket))
        .limit(250),
      getOfficePoints(),
    ]);
    const withCoords = officePts.filter((o) => o.lat != null && o.lng != null) as {
      lat: number;
      lng: number;
    }[];
    let rows = pool;
    if (withCoords.length) {
      rows = pool.filter(
        (r) =>
          r.latitude != null &&
          r.longitude != null &&
          withCoords.some((o) => approxMiles(o.lat, o.lng, r.latitude as number, r.longitude as number) <= SERVICE_AREA_MILES),
      );
    }
    return rows.slice(0, limit).map(gateAddress);
  } catch (err) {
    console.warn('[buyerHome] getRecentActiveListings failed:', err);
    return [];
  }
}

export interface BuyerCityTile {
  city: string;
  activeCount: number;
  photoUrl: string | null;
}

/**
 * The 12 buyer city tiles: cities within 20 mi of an office with the most active
 * listings, minus the admin exclusion list (tiles only — excluded cities still
 * resolve in /homes search).
 */
export async function getBuyerCityTiles(limit = 12): Promise<BuyerCityTile[]> {
  try {
    const [statRows, offices_, excluded] = await Promise.all([
      db
        .select({
          city: idxListings.city,
          count: sql<number>`count(*)::int`,
          lat: sql<number>`avg(${idxListings.latitude})`,
          lng: sql<number>`avg(${idxListings.longitude})`,
        })
        .from(idxListings)
        .where(and(forSaleWhere, isNotNull(idxListings.city)))
        .groupBy(idxListings.city),
      getOfficePoints(),
      getBuyerExcludedCities(),
    ]);

    const stats: CityActiveStat[] = statRows
      .filter((r) => r.city)
      .map((r) => ({ city: r.city as string, count: Number(r.count), lat: r.lat, lng: r.lng }));

    const selected = rankBuyerCityTiles(stats, offices_, excluded, limit, SERVICE_AREA_MILES);
    if (!selected.length) return [];

    // A representative photo per selected city — the newest active listing photo.
    const cities = selected.map((s) => s.city);
    const photoRows = await db
      .select({ city: idxListings.city, photoUrl: idxListings.photoUrl })
      .from(idxListings)
      .where(and(forSaleWhere, inArray(idxListings.city, cities)))
      .orderBy(desc(idxListings.modificationTimestamp));
    const photoByCity = new Map<string, string>();
    for (const p of photoRows) {
      if (p.city && p.photoUrl && !photoByCity.has(p.city)) photoByCity.set(p.city, p.photoUrl);
    }

    return selected.map((s) => ({
      city: s.city,
      activeCount: s.count,
      photoUrl: photoByCity.get(s.city) ?? null,
    }));
  } catch (err) {
    console.warn('[buyerHome] getBuyerCityTiles failed:', err);
    return [];
  }
}
