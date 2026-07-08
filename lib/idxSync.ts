/**
 * IDX sync pipeline (IDX spec §2). Mirrors Realcomp listing data into the local
 * idx_listings table (+ idx_listing_photos) so page reads are instant and IDX's
 * "refresh at least every 12 hours" rule is satisfied comfortably (we run hourly).
 *
 * Two queries per run (IDX spec §2.1):
 *   Query 1 — your offices' listings/sales, no geographic filter (your stats).
 *   Query 2 — all Active/Pending/Closed feed-wide, no office/location filter
 *             (Similar Homes + Market Report).
 *
 * No stale deactivation (IDX spec §2.4): trust Realcomp's StandardStatus; a
 * listing missing from an incremental run is almost certainly still valid.
 *
 * NOTE ON ODATA DIALECT: a few filter/field specifics (enum value quoting, the
 * `in` operator, the exact MLS-number field) can only be confirmed against the
 * live $metadata. They are centralized in the constants below and validated by
 * `scripts/idx-verify-metadata.ts`; adjust there if the live schema differs.
 */
import { sql, getTableColumns, inArray, eq, max } from 'drizzle-orm';
import { db } from './db';
import {
  idxListings,
  idxListingPhotos,
  idxSyncLog,
  type NewIdxListing,
  type NewIdxListingPhoto,
} from '../drizzle/schema';

// ---------------------------------------------------------------------------
// OData field selection (IDX spec §2.4, Township removed — no such field)
// ---------------------------------------------------------------------------
export const SELECT_FIELDS = [
  'ListingKey', 'ListingId', 'ListOfficeKey', 'BuyerOfficeKey', 'CoListOfficeKey',
  'CoBuyerOfficeKey', 'MlsStatus', 'StandardStatus', 'ListPrice', 'ClosePrice',
  'CloseDate', 'DaysOnMarket', 'CumulativeDaysOnMarket', 'OriginalListPrice',
  'PropertyType', 'PropertySubType', 'StreetNumber', 'StreetName', 'StreetSuffix',
  'StreetDirPrefix', 'StreetDirSuffix', 'UnitNumber', 'UnparsedAddress', 'City',
  'PostalCity', 'OriginalCity', 'OriginalPostalCity', 'CountyOrParish',
  'SubdivisionName', 'MLSAreaMajor', 'StateOrProvince', 'PostalCode', 'Latitude',
  'Longitude', 'BedroomsTotal', 'BathroomsTotalInteger', 'BathroomsFull',
  'BathroomsHalf', 'LivingArea', 'YearBuilt', 'LotSizeAcres', 'PhotosCount',
  'ListOfficeName', 'ListOfficePhone', 'OriginatingSystemName', 'ModificationTimestamp',
  'VirtualTourURLUnbranded', 'PublicRemarks', 'GarageSpaces', 'Basement',
  'ElementarySchoolDistrict', 'HighSchoolDistrict', 'WaterfrontYN', 'WaterfrontFeatures',
  'WaterBodyName', 'WaterFrontageFeet', 'InternetAddressDisplayYN',
  'InternetEntireListingDisplayYN',
].join(',');

// Media is a NavigationProperty — expand it to pull the photo set (IDX spec §2.5).
export const MEDIA_EXPAND = 'Media($select=MediaURL,Order,MediaCategory)';

// Enum values are sent as quoted strings in the filter. If the live $metadata
// shows StandardStatus as a namespaced enum requiring a different form, change
// this single helper.
function enumEq(field: string, value: string): string {
  return `${field} eq '${value}'`;
}

// ---------------------------------------------------------------------------
// Office keys (IDX spec §2.4) — parsed from REALCOMP_OFFICE_KEYS at runtime
// ---------------------------------------------------------------------------
export function parseOfficeKeys(): string[] {
  return (process.env.REALCOMP_OFFICE_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Build the "any of my offices on either side" OData clause, or null if unset. */
export function officeFilterClause(): string | null {
  const keys = parseOfficeKeys();
  if (keys.length === 0) return null;
  // Office keys are numeric ids — sent unquoted. The `in` operator keeps the URL
  // compact vs. 96 `eq` clauses. Change to quoted if $metadata types them as strings.
  const list = keys.join(',');
  return (
    `(ListOfficeKey in (${list}) or BuyerOfficeKey in (${list})` +
    ` or CoListOfficeKey in (${list}) or CoBuyerOfficeKey in (${list}))`
  );
}

const officeKeySet = () => new Set(parseOfficeKeys());

// ---------------------------------------------------------------------------
// Coercion helpers — defensive against missing/renamed fields
// ---------------------------------------------------------------------------
type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function int(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}
function real(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v: unknown): boolean | null {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1' || s === 'y') return true;
  if (s === 'false' || s === 'no' || s === '0' || s === 'n') return false;
  return null;
}
function date(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** camelCase / PascalCase enum tokens → spaced words ("LakeFront" → "Lake Front"). */
function humanizeEnum(token: string): string {
  return token
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/** WaterfrontFeatures is an Enum MultiValue — serialize to a comma list (§2.2). */
export function serializeWaterfrontFeatures(v: unknown): string | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : [v];
  const parts = arr
    .map((x) => (x == null ? '' : humanizeEnum(String(x))))
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Concatenate street parts into a display address, falling back to UnparsedAddress. */
export function buildAddress(raw: Raw): string | null {
  const parts = [
    raw.StreetNumber, raw.StreetDirPrefix, raw.StreetName, raw.StreetSuffix, raw.StreetDirSuffix,
  ]
    .map((p) => str(p))
    .filter(Boolean);
  let addr = parts.join(' ').trim();
  const unit = str(raw.UnitNumber);
  if (unit) addr = `${addr} #${unit}`.trim();
  return addr || str(raw.UnparsedAddress);
}

/** Baths: prefer full + 0.5*half, else BathroomsTotalInteger (§2.5). */
export function computeBaths(raw: Raw): number | null {
  const full = real(raw.BathroomsFull);
  const half = real(raw.BathroomsHalf);
  if (full != null || half != null) return (full ?? 0) + 0.5 * (half ?? 0);
  return real(raw.BathroomsTotalInteger);
}

// ---------------------------------------------------------------------------
// Field mapping (IDX spec §2.5)
// ---------------------------------------------------------------------------
export function mapRealcompListing(raw: Raw): NewIdxListing | null {
  const listingKey = str(raw.ListingKey);
  if (!listingKey) return null; // primary upsert key — skip malformed rows
  const standardStatus = str(raw.StandardStatus) ?? 'Unknown';

  const keys = officeKeySet();
  const listOfficeKey = str(raw.ListOfficeKey);
  const buyerOfficeKey = str(raw.BuyerOfficeKey);
  const coListOfficeKey = str(raw.CoListOfficeKey);
  const coBuyerOfficeKey = str(raw.CoBuyerOfficeKey);
  const isOfficeListing = [listOfficeKey, buyerOfficeKey, coListOfficeKey, coBuyerOfficeKey].some(
    (k) => k != null && keys.has(k),
  );

  const modificationTimestamp = date(raw.ModificationTimestamp) ?? new Date();

  return {
    listingKey,
    listOfficeKey,
    buyerOfficeKey,
    coListOfficeKey,
    coBuyerOfficeKey,
    internetAddressDisplayYN: bool(raw.InternetAddressDisplayYN),
    internetEntireListingDisplayYN: bool(raw.InternetEntireListingDisplayYN),
    mlsNumber: str(raw.ListingId) ?? str(raw.MLSNumber),
    mlsStatus: str(raw.MlsStatus),
    standardStatus,
    listPrice: int(raw.ListPrice),
    closePrice: int(raw.ClosePrice),
    closeDate: date(raw.CloseDate),
    daysOnMarket: int(raw.DaysOnMarket),
    cumulativeDaysOnMarket: int(raw.CumulativeDaysOnMarket),
    originalListPrice: int(raw.OriginalListPrice),
    propertyType: str(raw.PropertyType),
    propertySubType: str(raw.PropertySubType),
    address: buildAddress(raw),
    city: str(raw.City),
    postalCity: str(raw.PostalCity),
    originalCity: str(raw.OriginalCity),
    originalPostalCity: str(raw.OriginalPostalCity),
    countyOrParish: str(raw.CountyOrParish),
    township: null, // no direct OData field; use geo proxies (originalCity/mlsAreaMajor/county) at query time
    subdivisionName: str(raw.SubdivisionName),
    mlsAreaMajor: str(raw.MLSAreaMajor),
    stateOrProvince: str(raw.StateOrProvince),
    postalCode: str(raw.PostalCode),
    latitude: real(raw.Latitude),
    longitude: real(raw.Longitude),
    bedsTotal: int(raw.BedroomsTotal),
    bathsTotal: computeBaths(raw),
    livingArea: int(raw.LivingArea),
    yearBuilt: int(raw.YearBuilt),
    lotSizeAcres: real(raw.LotSizeAcres),
    garageSpaces: int(raw.GarageSpaces),
    basement: str(raw.Basement),
    schoolDistrict: str(raw.HighSchoolDistrict) ?? str(raw.ElementarySchoolDistrict),
    waterfrontYN: bool(raw.WaterfrontYN),
    waterfrontFeatures: serializeWaterfrontFeatures(raw.WaterfrontFeatures),
    waterBodyName: str(raw.WaterBodyName),
    waterFrontageFeet: real(raw.WaterFrontageFeet),
    photoUrl: primaryPhotoUrl(raw),
    photosCount: int(raw.PhotosCount),
    virtualTourUrl: str(raw.VirtualTourURLUnbranded),
    publicRemarks: str(raw.PublicRemarks),
    listingOfficeName: str(raw.ListOfficeName),
    listingOfficePhone: str(raw.ListOfficePhone),
    originatingSystemName: str(raw.OriginatingSystemName),
    modificationTimestamp,
    isOfficeListing,
    lastSyncedAt: new Date(),
  };
}

/** Extract the expanded Media collection into photo rows, sorted by Order. */
export function extractPhotos(raw: Raw): { url: string; order: number; category: string | null }[] {
  const media = raw.Media;
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => {
      const mm = m as Raw;
      return { url: str(mm.MediaURL), order: int(mm.Order) ?? 0, category: str(mm.MediaCategory) };
    })
    .filter((m): m is { url: string; order: number; category: string | null } => Boolean(m.url))
    .sort((a, b) => a.order - b.order);
}

function primaryPhotoUrl(raw: Raw): string | null {
  const photos = extractPhotos(raw);
  return photos[0]?.url ?? null;
}

// ---------------------------------------------------------------------------
// Upsert (IDX spec §2.4) — keyed on listingKey; recompute photos per listing
// ---------------------------------------------------------------------------
// Every column except the identity/immutable key is refreshed from the new row.
const UPDATE_ON_CONFLICT = Object.fromEntries(
  Object.entries(getTableColumns(idxListings))
    .filter(([, col]) => col.name !== 'id' && col.name !== 'listing_key')
    .map(([prop, col]) => [prop, sql`excluded.${sql.identifier(col.name)}`]),
) as Record<string, unknown>;

const CHUNK = 200;

async function upsertListingChunk(rows: NewIdxListing[]): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(idxListings)
    .values(rows)
    .onConflictDoUpdate({ target: idxListings.listingKey, set: UPDATE_ON_CONFLICT });
  return rows.length;
}

async function replacePhotos(byListing: Map<string, NewIdxListingPhoto[]>): Promise<void> {
  const keys = [...byListing.keys()];
  if (keys.length === 0) return;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    await db.delete(idxListingPhotos).where(inArray(idxListingPhotos.listingKey, slice));
  }
  const allPhotos = keys.flatMap((k) => byListing.get(k) ?? []);
  for (let i = 0; i < allPhotos.length; i += CHUNK) {
    await db.insert(idxListingPhotos).values(allPhotos.slice(i, i + CHUNK));
  }
}

/**
 * Map + upsert a batch of raw OData records. Returns the number of listings
 * written. Photos are only touched for listings that actually carry a Media set
 * (so a lean incremental record without $expand doesn't wipe existing photos).
 */
export async function upsertRawListings(rawRecords: Raw[]): Promise<number> {
  const mapped: NewIdxListing[] = [];
  const photosByListing = new Map<string, NewIdxListingPhoto[]>();

  for (const raw of rawRecords) {
    const row = mapRealcompListing(raw);
    if (!row) continue;
    mapped.push(row);
    if (Array.isArray(raw.Media)) {
      const photos = extractPhotos(raw).map((p) => ({
        listingKey: row.listingKey,
        mediaUrl: p.url,
        sortOrder: p.order,
        mediaCategory: p.category,
      }));
      photosByListing.set(row.listingKey, photos);
    }
  }

  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    upserted += await upsertListingChunk(mapped.slice(i, i + CHUNK));
  }
  // Photos reference idx_listings.listing_key, so upsert listings first.
  await replacePhotos(photosByListing);
  return upserted;
}

// ---------------------------------------------------------------------------
// Sync cursor + query builders
// ---------------------------------------------------------------------------
/** ISO string of the newest modificationTimestamp we already hold, or null. */
export async function getSyncCursor(): Promise<string | null> {
  const rows = await db.select({ m: max(idxListings.modificationTimestamp) }).from(idxListings);
  const m = rows[0]?.m;
  return m ? new Date(m).toISOString() : null;
}

function oneYearAgoIso(): string {
  return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
}

/** Active + Pending + Closed status clause (IDX spec §2.4 Query 2). */
function activePendingClosedClause(): string {
  return `(${enumEq('StandardStatus', 'Active')} or ${enumEq('StandardStatus', 'Pending')} or ${enumEq('StandardStatus', 'Closed')})`;
}

type FetchFn = (path: string, params: Record<string, string>) => Promise<Raw[]>;

async function runQuery(fetchFn: FetchFn, filter: string): Promise<Raw[]> {
  return fetchFn('Property', {
    $select: SELECT_FIELDS,
    $expand: MEDIA_EXPAND,
    $filter: filter,
  });
}

// ---------------------------------------------------------------------------
// Sync entrypoints
// ---------------------------------------------------------------------------
export interface SyncResult {
  query1Fetched: number;
  query1Upserted: number;
  query2Fetched: number;
  query2Upserted: number;
}

/**
 * Hourly incremental sync (IDX spec §2.6). Runs Query 1 (your offices) and
 * Query 2 (all Active/Pending/Closed), both filtered by ModificationTimestamp
 * since the last cursor, and logs a idx_sync_log row.
 */
export async function runIdxSync(fetchFn: FetchFn): Promise<SyncResult> {
  const [logRow] = await db
    .insert(idxSyncLog)
    .values({ syncStartedAt: new Date(), status: 'running' })
    .returning({ id: idxSyncLog.id });
  const logId = logRow.id;

  try {
    const cursor = await getSyncCursor();
    const sinceClause = cursor ? `ModificationTimestamp gt ${cursor}` : `ModificationTimestamp gt ${oneYearAgoIso()}`;

    // Query 1 — your offices, no geographic filter (all statuses that changed).
    const office = officeFilterClause();
    let q1Fetched = 0;
    let q1Upserted = 0;
    if (office) {
      const raw1 = await runQuery(fetchFn, `${office} and ${sinceClause}`);
      q1Fetched = raw1.length;
      q1Upserted = await upsertRawListings(raw1);
    }

    // Query 2 — all Active/Pending/Closed, feed-wide.
    const raw2 = await runQuery(fetchFn, `${activePendingClosedClause()} and ${sinceClause}`);
    const q2Fetched = raw2.length;
    const q2Upserted = await upsertRawListings(raw2);

    await db
      .update(idxSyncLog)
      .set({
        syncCompletedAt: new Date(),
        status: 'success',
        query1RecordsFetched: q1Fetched,
        query1RecordsUpserted: q1Upserted,
        query2RecordsFetched: q2Fetched,
        query2RecordsUpserted: q2Upserted,
      })
      .where(eq(idxSyncLog.id, logId));

    return { query1Fetched: q1Fetched, query1Upserted: q1Upserted, query2Fetched: q2Fetched, query2Upserted: q2Upserted };
  } catch (err) {
    await db
      .update(idxSyncLog)
      .set({
        syncCompletedAt: new Date(),
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(idxSyncLog.id, logId));
    throw err;
  }
}

/**
 * OData $select/$expand/$filter params for the initial full pull of Query 2
 * (all Active/Pending/Closed, 12-month window, no office/location filter). Run
 * via GitHub Actions — too slow for Vercel's timeout (IDX spec §2.8).
 */
export function activeBackfillParams(): Record<string, string> {
  return {
    $select: SELECT_FIELDS,
    $expand: MEDIA_EXPAND,
    $filter: `${activePendingClosedClause()} and ModificationTimestamp gt ${oneYearAgoIso()}`,
  };
}

/**
 * OData params for the initial backfill of your offices' Closed sales over a
 * CloseDate window (one year at a time — IDX spec §2.8 Step 2/3).
 */
export function soldBackfillParams(startDate: string, endDate: string): Record<string, string> {
  const office = officeFilterClause();
  if (!office) throw new Error('REALCOMP_OFFICE_KEYS is not set — cannot run the sold backfill.');
  return {
    $select: SELECT_FIELDS,
    $expand: MEDIA_EXPAND,
    $filter:
      `${office} and ${enumEq('StandardStatus', 'Closed')}` +
      ` and CloseDate ge ${startDate} and CloseDate lt ${endDate}`,
  };
}
