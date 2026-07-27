/**
 * Server-side data layer for buyer save surfaces (favorites + saved searches).
 * Every function is scoped to a buyerUserId — callers pass the id from the
 * verified session, never from request input, so a buyer can only ever touch
 * their own rows. Phase 2 stores data only; the lead-on-engagement hook is
 * wired separately in Phase 4.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import {
  buyerFavorites,
  buyerListingViews,
  buyerSavedSearches,
  type BuyerFavorite,
  type BuyerSavedSearch,
} from '../drizzle/schema';
import {
  centroidOfFilters,
  describeSearch,
  normalizeFilters,
  type SearchFilters,
} from './listingSearch';

// --- Favorites -------------------------------------------------------------

/** All of a buyer's favorited listing keys, newest first. */
export async function listFavoriteKeys(buyerUserId: number): Promise<string[]> {
  const rows = await db
    .select({ listingKey: buyerFavorites.listingKey })
    .from(buyerFavorites)
    .where(eq(buyerFavorites.buyerUserId, buyerUserId))
    .orderBy(desc(buyerFavorites.createdAt));
  return rows.map((r) => r.listingKey);
}

/** Full favorite rows, newest first (for the account page). */
export async function listFavorites(buyerUserId: number): Promise<BuyerFavorite[]> {
  return db
    .select()
    .from(buyerFavorites)
    .where(eq(buyerFavorites.buyerUserId, buyerUserId))
    .orderBy(desc(buyerFavorites.createdAt));
}

/** Add a favorite (idempotent via the unique index). */
export async function addFavorite(buyerUserId: number, listingKey: string): Promise<void> {
  await db
    .insert(buyerFavorites)
    .values({ buyerUserId, listingKey })
    .onConflictDoNothing({ target: [buyerFavorites.buyerUserId, buyerFavorites.listingKey] });
}

/** Remove a favorite (no-op if it isn't there). */
export async function removeFavorite(buyerUserId: number, listingKey: string): Promise<void> {
  await db
    .delete(buyerFavorites)
    .where(and(eq(buyerFavorites.buyerUserId, buyerUserId), eq(buyerFavorites.listingKey, listingKey)));
}

// --- Saved searches --------------------------------------------------------

/** A saved search as returned to the client, with its filters re-hydrated. */
export interface SavedSearchView {
  id: number;
  name: string;
  filters: SearchFilters;
  createdAt: Date;
}

function toView(row: BuyerSavedSearch): SavedSearchView {
  let filters: SearchFilters = {};
  try {
    filters = normalizeFilters(JSON.parse(row.filtersJson) as Record<string, string | string[]>);
  } catch {
    /* corrupt row → empty filters, never throw to the caller */
  }
  return { id: row.id, name: row.name, filters, createdAt: row.createdAt };
}

/** All of a buyer's saved searches, newest first. */
export async function listSavedSearches(buyerUserId: number): Promise<SavedSearchView[]> {
  const rows = await db
    .select()
    .from(buyerSavedSearches)
    .where(eq(buyerSavedSearches.buyerUserId, buyerUserId))
    .orderBy(desc(buyerSavedSearches.createdAt));
  return rows.map(toView);
}

/**
 * Persist a saved search. The name is derived from the filters when the caller
 * doesn't supply one. The routing anchor (Phase 4) is the centroid of the
 * buyer's FIRST saved search, so we only stamp anchor_lat/lng when this is the
 * first row for the account.
 */
export async function createSavedSearch(
  buyerUserId: number,
  rawFilters: Record<string, string | string[] | undefined>,
  name?: string,
): Promise<SavedSearchView> {
  const filters = normalizeFilters(rawFilters);
  const label = (name?.trim() || describeSearch(filters)).slice(0, 200);

  const existing = await db
    .select({ id: buyerSavedSearches.id })
    .from(buyerSavedSearches)
    .where(eq(buyerSavedSearches.buyerUserId, buyerUserId))
    .limit(1);
  const isFirst = existing.length === 0;
  const anchor = isFirst ? centroidOfFilters(filters) : null;

  const inserted = await db
    .insert(buyerSavedSearches)
    .values({
      buyerUserId,
      name: label,
      filtersJson: JSON.stringify(rawFilters ?? {}),
      anchorLat: anchor?.lat ?? null,
      anchorLng: anchor?.lng ?? null,
    })
    .returning();
  return toView(inserted[0]);
}

/** Delete a saved search the buyer owns (scoped — no cross-account delete). */
export async function deleteSavedSearch(buyerUserId: number, id: number): Promise<void> {
  await db
    .delete(buyerSavedSearches)
    .where(and(eq(buyerSavedSearches.id, id), eq(buyerSavedSearches.buyerUserId, buyerUserId)));
}

// --- Activity --------------------------------------------------------------

/**
 * Record a listing view for a signed-in buyer: first view inserts, repeat views
 * bump last_viewed_at + view_count via the unique (buyer, listing) index. Best-
 * effort — a failure here never blocks page rendering. Viewing alone does NOT
 * create a lead (that is a save/inquiry action, wired in Phase 4).
 */
export async function recordListingView(buyerUserId: number, listingKey: string): Promise<void> {
  await db
    .insert(buyerListingViews)
    .values({ buyerUserId, listingKey })
    .onConflictDoUpdate({
      target: [buyerListingViews.buyerUserId, buyerListingViews.listingKey],
      set: {
        lastViewedAt: sql`now()`,
        viewCount: sql`${buyerListingViews.viewCount} + 1`,
      },
    });
}
