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
import { SELECT_FIELDS, MEDIA_EXPAND, upsertRawListings, mapRealcompListing } from '../idxSync';
import { normalizeAddress } from '../addressNormalization';

/** A lightweight description of a listing the pull returned (for diagnostics). */
export interface FetchedRowSummary {
  address: string | null;
  standardStatus: string;
  closeDate: string | null; // ISO date
  closePrice: number | null;
}

export interface AddressHistoryResult {
  ok: boolean;
  fetched: number;
  upserted: number;
  reason?: string;
  /** The OData $filter actually used (for diagnostics). */
  filter?: string;
  /** Up to ~20 of the listings returned, so the caller can explain a no-match. */
  rows: FetchedRowSummary[];
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
    return { ok: false, fetched: 0, upserted: 0, reason: 'Realcomp not configured', rows: [] };
  }
  const raw = address.trim();
  const streetNum = (raw.match(/^\s*(\d+)/) ?? [])[1];
  if (!streetNum) return { ok: false, fetched: 0, upserted: 0, reason: 'no house number in address', rows: [] };

  const zip = normalizeAddress(raw).zip;

  // Run one $filter to exhaustion: map each row for the diagnostic summary and
  // upsert every page. Returns fresh counts/rows per call.
  const runQuery = async (filter: string): Promise<{ fetched: number; upserted: number; rows: FetchedRowSummary[] }> => {
    let fetched = 0;
    let upserted = 0;
    const rows: FetchedRowSummary[] = [];
    await realcompFetchPages(
      'Property',
      { $select: SELECT_FIELDS, $expand: MEDIA_EXPAND, $filter: filter },
      async (page) => {
        fetched += page.length;
        for (const r of page) {
          if (rows.length >= 20) break;
          const m = mapRealcompListing(r as Record<string, unknown>);
          if (!m) continue;
          rows.push({
            address: m.address ?? null,
            standardStatus: m.standardStatus,
            closeDate: m.closeDate ? new Date(m.closeDate).toISOString().slice(0, 10) : null,
            closePrice: m.closePrice ?? null,
          });
        }
        upserted += await upsertRawListings(page as Record<string, unknown>[]);
      },
      { pageSize: 100, timeoutMs: 30_000, label: 'avm-addr' },
    );
    return { fetched, upserted, rows };
  };

  try {
    // Try the tight filter first (fewer results). PostalCode is brittle — it can be
    // absent, ZIP+4, or stored differently per record — so if the tight filter
    // returns nothing, fall back to StreetNumber alone and let the caller match
    // precisely by normalized address in JS. StreetNumber is a discrete, confirmed-
    // filterable field.
    let filter = zip ? `StreetNumber eq ${odataStr(streetNum)} and PostalCode eq ${odataStr(zip)}` : `StreetNumber eq ${odataStr(streetNum)}`;
    let r = await runQuery(filter);
    if (r.fetched === 0 && zip) {
      filter = `StreetNumber eq ${odataStr(streetNum)}`;
      r = await runQuery(filter);
    }
    return { ok: true, fetched: r.fetched, upserted: r.upserted, rows: r.rows, filter };
  } catch (err) {
    return { ok: false, fetched: 0, upserted: 0, reason: err instanceof Error ? err.message : 'fetch failed', rows: [] };
  }
}
