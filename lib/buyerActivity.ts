/**
 * Read-only buyer-activity summary for the agent/admin lead pages. Given the
 * buyer account linked to a lead, returns their saved homes, saved searches, and
 * recently-viewed listings. Scoped to one buyer; no mutation.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { buyerListingViews, buyerSavedSearches, buyerUsers } from '../drizzle/schema';
import { getListingsByKeys } from './idx';
import { listFavoriteKeys } from './buyerSaves';
import { describeSearch, normalizeFilters } from './listingSearch';

export interface BuyerActivityListing {
  listingKey: string;
  address: string | null;
  city: string | null;
  price: number | null;
  lastViewedAt?: Date;
  viewCount?: number;
}

export interface BuyerActivitySummary {
  name: string | null;
  email: string;
  representedElsewhere: boolean;
  favorites: BuyerActivityListing[];
  savedSearches: { id: number; name: string; description: string }[];
  recentViews: BuyerActivityListing[];
}

const RECENT_VIEW_LIMIT = 12;

export async function getBuyerActivity(buyerUserId: number): Promise<BuyerActivitySummary | null> {
  const buyerRows = await db.select().from(buyerUsers).where(eq(buyerUsers.id, buyerUserId)).limit(1);
  const buyer = buyerRows[0];
  if (!buyer) return null;

  const [favKeys, searchRows, viewRows] = await Promise.all([
    listFavoriteKeys(buyerUserId),
    db
      .select()
      .from(buyerSavedSearches)
      .where(eq(buyerSavedSearches.buyerUserId, buyerUserId))
      .orderBy(desc(buyerSavedSearches.createdAt)),
    db
      .select()
      .from(buyerListingViews)
      .where(eq(buyerListingViews.buyerUserId, buyerUserId))
      .orderBy(desc(buyerListingViews.lastViewedAt))
      .limit(RECENT_VIEW_LIMIT),
  ]);

  // Resolve listing details for favorites + recent views in one batch.
  const allKeys = Array.from(new Set([...favKeys, ...viewRows.map((v) => v.listingKey)]));
  const listings = allKeys.length ? await getListingsByKeys(allKeys) : [];
  const byKey = new Map(listings.map((l) => [l.listingKey, l]));

  const toListing = (key: string, extra?: { lastViewedAt: Date; viewCount: number }): BuyerActivityListing => {
    const l = byKey.get(key);
    return {
      listingKey: key,
      address: l?.address ?? null,
      city: l?.city ?? null,
      price: l?.listPrice ?? null,
      ...extra,
    };
  };

  return {
    name: buyer.name,
    email: buyer.email,
    representedElsewhere: buyer.representedElsewhere,
    favorites: favKeys.map((k) => toListing(k)),
    savedSearches: searchRows.map((s) => {
      let description = s.name;
      try {
        description = describeSearch(normalizeFilters(JSON.parse(s.filtersJson)));
      } catch {
        /* keep the stored name */
      }
      return { id: s.id, name: s.name, description };
    }),
    recentViews: viewRows.map((v) => toListing(v.listingKey, { lastViewedAt: v.lastViewedAt, viewCount: v.viewCount })),
  };
}
