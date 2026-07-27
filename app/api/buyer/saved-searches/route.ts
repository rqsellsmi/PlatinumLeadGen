/**
 * Buyer saved-searches API. Session-scoped like favorites: 401 when signed out,
 * every query bound to the buyer's id. Same-origin guarded in middleware.
 *
 *   GET               → { searches: SavedSearchView[] }
 *   POST  { filters, name? }   persist a search (name derived when omitted)
 *   DELETE { id }              delete one the buyer owns
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuyerUserId } from '@/lib/buyerSession';
import { createSavedSearch, deleteSavedSearch, listSavedSearches } from '@/lib/buyerSaves';
import { needsRepresentationAnswer, onFirstEngagement, parseRepresentation } from '@/lib/buyerEngagement';
import { centroidOfFilters } from '@/lib/listingSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Saved-search cap per buyer — generous but bounds abuse of unbounded inserts. */
const MAX_SAVED_SEARCHES = 100;

export async function GET() {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ searches: await listSavedSearches(buyerId) });
}

export async function POST(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const filters = body?.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const name = typeof body?.name === 'string' ? body.name : undefined;

  const existing = await listSavedSearches(buyerId);
  if (existing.length >= MAX_SAVED_SEARCHES) {
    return NextResponse.json({ error: 'limit_reached' }, { status: 409 });
  }

  const search = await createSavedSearch(buyerId, filters as Record<string, string | string[]>, name);

  // Saving a search is a lead-creating action; the routing anchor is this
  // search's centroid. Ask the representation question once before the first lead.
  const representation = parseRepresentation(body?.representation);
  if (!representation && (await needsRepresentationAnswer(buyerId))) {
    return NextResponse.json({ ok: true, search, needsRepresentation: true });
  }
  const centroid = centroidOfFilters(search.filters);
  try {
    await onFirstEngagement({
      buyerUserId: buyerId,
      kind: 'saved_search',
      savedSearch: { name: search.name, lat: centroid?.lat ?? null, lng: centroid?.lng ?? null },
      representation,
    });
  } catch (err) {
    console.error('[api/buyer/saved-searches] engagement failed:', err);
  }
  return NextResponse.json({ ok: true, search });
}

export async function DELETE(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await deleteSavedSearch(buyerId, id);
  return NextResponse.json({ ok: true });
}
