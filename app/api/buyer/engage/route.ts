/**
 * POST /api/buyer/engage — run the lead-on-engagement step for an ALREADY-saved
 * favorite or saved search, once the buyer has answered the representation
 * question. Kept separate from the save endpoints so re-submitting the answer
 * never creates a duplicate favorite/search. Session-scoped; same-origin guarded.
 *
 *   { kind: 'favorite', listingKey, representation }
 *   { kind: 'saved_search', savedSearchId, representation }
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { buyerSavedSearches } from '@/drizzle/schema';
import { getBuyerUserId } from '@/lib/buyerSession';
import { onFirstEngagement, parseRepresentation } from '@/lib/buyerEngagement';
import { centroidOfFilters, normalizeFilters } from '@/lib/listingSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const representation = parseRepresentation(body?.representation);
  if (!representation) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    if (body?.kind === 'favorite') {
      const listingKey = typeof body.listingKey === 'string' ? body.listingKey.trim() : '';
      if (!listingKey) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      await onFirstEngagement({ buyerUserId: buyerId, kind: 'favorite', listingKey, representation });
    } else if (body?.kind === 'saved_search') {
      const id = Number(body.savedSearchId);
      if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      const rows = await db
        .select()
        .from(buyerSavedSearches)
        .where(and(eq(buyerSavedSearches.id, id), eq(buyerSavedSearches.buyerUserId, buyerId)))
        .limit(1);
      const search = rows[0];
      if (!search) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      let centroid = search.anchorLat != null && search.anchorLng != null
        ? { lat: search.anchorLat, lng: search.anchorLng }
        : null;
      if (!centroid) {
        try {
          centroid = centroidOfFilters(normalizeFilters(JSON.parse(search.filtersJson)));
        } catch {
          centroid = null;
        }
      }
      await onFirstEngagement({
        buyerUserId: buyerId,
        kind: 'saved_search',
        savedSearch: { name: search.name, lat: centroid?.lat ?? null, lng: centroid?.lng ?? null },
        representation,
      });
    } else {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
  } catch (err) {
    console.error('[api/buyer/engage] failed:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
