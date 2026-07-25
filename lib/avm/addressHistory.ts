/**
 * On-demand MLS address-history pull (spec §18.2 cascade step 2).
 *
 * When a backtest subject has fewer than two closed sales in our DB, we query the
 * Realcomp feed for that specific address, upsert whatever comes back into
 * idx_listings, and let the caller re-read from the DB. This lets us characterize
 * a subject from its own MLS history even when the incremental sync hasn't pulled
 * it, and it opportunistically deepens our data one address at a time.
 *
 * Reuses the existing feed plumbing (`SELECT_FIELDS`/`MEDIA_EXPAND`,
 * `realcompFetchPages`, `upsertRawListings`) so a listing pulled here is stored
 * identically to one from the hourly sync. Admin-internal (spec §19).
 *
 * Degrades safely: no-ops when Realcomp isn't configured (no creds in a code-only
 * build), and a fetch/upsert failure returns `ok:false` with a reason instead of
 * throwing, so the backtest falls through to the provider fallback.
 */
import { realcompFetchPages, isRealcompConfigured } from '../realcomp';
import { SELECT_FIELDS, MEDIA_EXPAND, upsertRawListings } from '../idxSync';
import { normalizeAddress } from '../addressNormalization';

export interface AddressHistoryResult {
  ok: boolean;
  fetched: number;
  upserted: number;
  reason?: string;
}

/** OData single-quoted string literal (doubles embedded quotes). */
function odataStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Pull an address's listing history from Realcomp and upsert it.
 *
 * The OData filter uses `StreetNumber` (+ `PostalCode` when we can parse it) — the
 * cleanest discrete fields; Realcomp's `City` is a county-suffixed enum (lessons
 * §12b) so it's unreliable to filter on. The exact filterable field names are a
 * first-connection verify item like the rest of the feed; whatever the query
 * returns is re-matched by normalized address in JS by the caller, so a slightly
 * broad filter (same street number, different street) is harmless — it just stores
 * a few extra legitimate comps. Uses client-driven paging (`pageSize`) because a
 * filtered Realcomp query returns an empty first page under server paging
 * (lessons §16b).
 */
export async function fetchAddressHistoryFromMls(address: string): Promise<AddressHistoryResult> {
  if (!isRealcompConfigured()) {
    return { ok: false, fetched: 0, upserted: 0, reason: 'Realcomp not configured' };
  }
  const raw = address.trim();
  const streetNum = (raw.match(/^\s*(\d+)/) ?? [])[1];
  if (!streetNum) return { ok: false, fetched: 0, upserted: 0, reason: 'no house number in address' };

  const zip = normalizeAddress(raw).zip;
  const clauses = [`StreetNumber eq ${odataStr(streetNum)}`];
  if (zip) clauses.push(`PostalCode eq ${odataStr(zip)}`);
  const filter = clauses.join(' and ');

  let fetched = 0;
  let upserted = 0;
  try {
    await realcompFetchPages(
      'Property',
      { $select: SELECT_FIELDS, $expand: MEDIA_EXPAND, $filter: filter },
      async (page) => {
        fetched += page.length;
        upserted += await upsertRawListings(page as Record<string, unknown>[]);
      },
      { pageSize: 100, timeoutMs: 30_000, label: 'avm-addr' },
    );
  } catch (err) {
    return { ok: false, fetched, upserted, reason: err instanceof Error ? err.message : 'fetch failed' };
  }
  return { ok: true, fetched, upserted };
}
