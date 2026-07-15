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
  idxBackfillCheckpoints,
  type NewIdxListing,
  type NewIdxListingPhoto,
} from '../drizzle/schema';

// ---------------------------------------------------------------------------
// OData field selection (IDX spec §2.4, Township removed — no such field)
// ---------------------------------------------------------------------------
export const SELECT_FIELDS = [
  'ListingKey', 'ListingId', 'ListOfficeMlsId', 'BuyerOfficeMlsId',
  'CoListOfficeMlsId', 'CoBuyerOfficeMlsId', 'MlsStatus', 'StandardStatus', 'ListPrice', 'ClosePrice',
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
  // Buyer-relevant "data sheet" fields (0021). Enum multi-values (Heating,
  // Appliances, InteriorFeatures, …) come back as arrays and are serialized to
  // comma lists; scalars map straight through.
  'ArchitecturalStyle', 'Levels', 'StoriesTotal', 'RoomsTotal', 'Heating', 'Cooling',
  'FireplacesTotal', 'FireplaceFeatures', 'LaundryFeatures', 'InteriorFeatures',
  'ExteriorFeatures', 'Appliances', 'Flooring', 'ConstructionMaterials', 'Roof',
  'FoundationDetails', 'ParkingFeatures', 'AttachedGarageYN', 'PoolPrivateYN',
  'PoolFeatures', 'PatioAndPorchFeatures', 'LotFeatures', 'LotSizeDimensions', 'View',
  'WaterSource', 'Sewer', 'Utilities', 'NewConstructionYN', 'Zoning', 'AssociationYN',
  'AssociationFee', 'AssociationFeeFrequency', 'AssociationFeeIncludes', 'AssociationAmenities',
  // Realcomp's live $metadata declares TaxAnnualAmount but NOT TaxYear (verified
  // via scripts/idx-verify-metadata.ts). Selecting a field the feed doesn't
  // declare makes Realcomp 400 the whole query, so TaxYear is omitted here. The
  // taxYear column + mapping stay (harmless null; picks it up automatically if
  // Realcomp ever adds the field) and the listing page hides the year when null.
  'TaxAnnualAmount',
].join(',');

// Media is a NavigationProperty — expand it to pull the photo set (IDX spec §2.5).
// NB: a nested `$top=1`/`$orderby=Order` here to fetch only the primary photo is
// SLOWER on Realcomp (the server sorts+limits media per listing), so we always
// pull the full set and gate STORAGE by status instead (see upsertRawListings).
export const MEDIA_EXPAND = 'Media($select=MediaURL,Order,MediaCategory)';

// Enum values are sent as quoted strings in the filter. If the live $metadata
// shows StandardStatus as a namespaced enum requiring a different form, change
// this single helper.
function enumEq(field: string, value: string): string {
  return `${field} eq '${value}'`;
}

/**
 * The RESO StandardStatus values we sync + display. `ActiveUnderContract` is
 * where the Realcomp local statuses "Active Backup Offers" and "Contingent
 * Continue to Show" normalize to — they're still-active (not Expired/Withdrawn,
 * which §18.3.9 bars), so we carry them. Expired/Withdrawn/Canceled/ComingSoon/
 * Hold are intentionally excluded.
 *
 * IMPORTANT: StandardStatus is an OData ENUMERATION, so filter constants must be
 * the enum MEMBER NAME (space-less token) — `ActiveUnderContract`, NOT
 * "Active Under Contract" (the feed rejects the spaced form as "not a valid
 * enumeration type constant"). The feed also *returns* this token, so it's what
 * we store in idx_listings.standard_status and compare against everywhere.
 */
export const DISPLAYABLE_STANDARD_STATUSES = [
  'Active',
  'ActiveUnderContract',
  'Pending',
  'Closed',
] as const;

/**
 * Statuses that may show the FULL photo gallery. §18.10 restricts only *pending*
 * and *sold* to the primary photo; Active and ActiveUnderContract (backup /
 * contingent, still actively marketed) are neither, so both show all photos.
 * Pending and Closed fall through to primary-only.
 */
export const FULL_GALLERY_STATUSES: readonly string[] = ['Active', 'ActiveUnderContract'];
export function showsFullGallery(standardStatus: string): boolean {
  return FULL_GALLERY_STATUSES.includes(standardStatus);
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

// REALCOMP_OFFICE_KEYS hold OfficeMlsId values (confirmed against the Office
// collection), so we filter/match on the *OfficeMlsId fields, not *KeyNumeric.
const OFFICE_KEY_FIELDS = [
  'ListOfficeMlsId',
  'BuyerOfficeMlsId',
  'CoListOfficeMlsId',
  'CoBuyerOfficeMlsId',
] as const;

/**
 * One OData clause per office field. We split across fields — rather than OR-ing
 * all four into one filter — so each request URL stays well under IIS's ~2KB
 * query-string limit (a single 4-field clause with ~24 keys blows past it and
 * IIS returns a generic 404). OfficeMlsId is Edm.String, so values are quoted.
 * Results union via the listingKey upsert. Returns [] when the env var is unset.
 */
export function officeFieldClauses(): string[] {
  const keys = parseOfficeKeys();
  if (keys.length === 0) return [];
  const list = keys.map((k) => `'${k}'`).join(',');
  return OFFICE_KEY_FIELDS.map((f) => `${f} in (${list})`);
}

// ---------------------------------------------------------------------------
// URL-length-safe office filter batching (IDX spec §2.4)
// ---------------------------------------------------------------------------
// Realcomp runs on IIS, whose default query-string cap is ~2048 bytes
// (maxQueryStringLength). Exceed it and IIS returns a GENERIC 404 HTML page —
// which surfaces here as "Realcomp API error: 404" and silently breaks the
// sync. The $select list alone is ~1.6KB once URL-encoded, so listing every
// office key in a single `in (...)` filter blows past the cap (measured: 24
// keys → ~2.26KB). We pack the keys into as-large-as-fits batches by MEASURING
// the exact query string realcompFetch will send, so this stays correct as the
// field list or key set grows (batches shrink automatically, to one key each).
//
// NOTE: even a single-key office request is already ~1.8KB because $select is so
// large, and the feed-wide Query 2 (no office keys) sits at ~1.9KB — there is
// little headroom left. If the select list grows much further, move these reads
// to an OData POST `$query` (filter/select in the body) to drop the URL-length
// constraint entirely.
const QUERY_STRING_BUDGET = 1950; // stay comfortably under IIS's 2048 default

/** Length of the query string realcompFetch sends for a given $filter/$expand. */
function queryStringLength(filter: string, expand: string): number {
  const u = new URL('https://host/Property');
  u.searchParams.set('$select', SELECT_FIELDS);
  u.searchParams.set('$expand', expand);
  u.searchParams.set('$filter', filter);
  return u.search.length - 1; // drop the leading '?'
}

/**
 * Fully-formed $filter strings for the office pass — one or more per office-key
 * field — each guaranteed to keep the request query string under the IIS limit.
 * `extraClause` is AND-ed onto every batch (the sync's ModificationTimestamp
 * cursor, or the sold backfill's CloseDate window); `expand` is the Media expand
 * that request will use (its length counts toward the query string). The first
 * key in a batch is always accepted even if it alone would exceed the soft
 * budget (still well under the hard 2048 cap). Returns [] when the keys are
 * unset. Results union naturally via the listingKey upsert.
 */
export function officeFilterBatches(extraClause: string, expand: string): string[] {
  const keys = parseOfficeKeys();
  if (keys.length === 0) return [];
  const clause = (field: string, ks: string[]) =>
    `${field} in (${ks.map((k) => `'${k}'`).join(',')}) and ${extraClause}`;

  const filters: string[] = [];
  for (const field of OFFICE_KEY_FIELDS) {
    let batch: string[] = [];
    for (const key of keys) {
      const trial = [...batch, key];
      if (batch.length > 0 && queryStringLength(clause(field, trial), expand) > QUERY_STRING_BUDGET) {
        filters.push(clause(field, batch));
        batch = [key];
      } else {
        batch = trial;
      }
    }
    if (batch.length > 0) filters.push(clause(field, batch));
  }
  return filters;
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

/**
 * Serialize a RESO Enum MultiValue (array of tokens) — or a single value — to a
 * human-readable comma list ("ForcedAir","CentralAir" → "Forced Air, Central
 * Air"). Deduplicates and drops blanks. Used for every multi-value descriptive
 * field (Heating, Appliances, InteriorFeatures, …). §2.2.
 */
export function serializeEnumList(v: unknown): string | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : [v];
  const parts = arr
    .map((x) => (x == null ? '' : humanizeEnum(String(x))))
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(', ') : null;
}

/** WaterfrontFeatures is an Enum MultiValue — serialize to a comma list (§2.2). */
export function serializeWaterfrontFeatures(v: unknown): string | null {
  return serializeEnumList(v);
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

/**
 * Clean mailing city. Realcomp normalizes City into an enum label like
 * "SturgisCity_StJoseph" (city+county) and OriginalCity carries abbreviations
 * ("Sturgis City", "Lockport Twp") — the clean mailing name lives in
 * OriginalPostalCity ("Sturgis"). Fall back through the rest, de-enum-ifying.
 */
export function cleanCity(raw: Raw): string | null {
  const op = str(raw.OriginalPostalCity);
  if (op) return op;
  const oc = str(raw.OriginalCity);
  if (oc) return oc;
  // PostalCity / City are county-suffixed enums (e.g. "Sturgis_StJoseph") —
  // drop the trailing _County segment and space out camelCase.
  const enumCity = str(raw.PostalCity) ?? str(raw.City);
  if (!enumCity) return null;
  return humanizeEnum(enumCity.replace(/_[^_]+$/, ''));
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
  // REALCOMP_OFFICE_KEYS are OfficeMlsId values, so match on *OfficeMlsId.
  const listOfficeKey = str(raw.ListOfficeMlsId);
  const buyerOfficeKey = str(raw.BuyerOfficeMlsId);
  const coListOfficeKey = str(raw.CoListOfficeMlsId);
  const coBuyerOfficeKey = str(raw.CoBuyerOfficeMlsId);
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
    city: cleanCity(raw),
    postalCity: str(raw.PostalCity),
    originalCity: str(raw.OriginalCity),
    originalPostalCity: str(raw.OriginalPostalCity),
    // CountyOrParish is an enum too ("StJoseph" -> "St Joseph").
    countyOrParish: (() => {
      const c = str(raw.CountyOrParish);
      return c ? humanizeEnum(c) : null;
    })(),
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
    // Buyer-relevant detail (0021).
    architecturalStyle: serializeEnumList(raw.ArchitecturalStyle),
    levels: serializeEnumList(raw.Levels),
    storiesTotal: int(raw.StoriesTotal),
    roomsTotal: int(raw.RoomsTotal),
    heating: serializeEnumList(raw.Heating),
    cooling: serializeEnumList(raw.Cooling),
    fireplacesTotal: int(raw.FireplacesTotal),
    fireplaceFeatures: serializeEnumList(raw.FireplaceFeatures),
    laundryFeatures: serializeEnumList(raw.LaundryFeatures),
    interiorFeatures: serializeEnumList(raw.InteriorFeatures),
    exteriorFeatures: serializeEnumList(raw.ExteriorFeatures),
    appliances: serializeEnumList(raw.Appliances),
    flooring: serializeEnumList(raw.Flooring),
    constructionMaterials: serializeEnumList(raw.ConstructionMaterials),
    roof: serializeEnumList(raw.Roof),
    foundationDetails: serializeEnumList(raw.FoundationDetails),
    parkingFeatures: serializeEnumList(raw.ParkingFeatures),
    attachedGarageYN: bool(raw.AttachedGarageYN),
    poolPrivateYN: bool(raw.PoolPrivateYN),
    poolFeatures: serializeEnumList(raw.PoolFeatures),
    patioAndPorchFeatures: serializeEnumList(raw.PatioAndPorchFeatures),
    lotFeatures: serializeEnumList(raw.LotFeatures),
    lotSizeDimensions: str(raw.LotSizeDimensions),
    view: serializeEnumList(raw.View),
    waterSource: serializeEnumList(raw.WaterSource),
    sewer: serializeEnumList(raw.Sewer),
    utilities: serializeEnumList(raw.Utilities),
    newConstructionYN: bool(raw.NewConstructionYN),
    zoning: str(raw.Zoning),
    associationYN: bool(raw.AssociationYN),
    associationFee: real(raw.AssociationFee),
    associationFeeFrequency: str(raw.AssociationFeeFrequency),
    associationFeeIncludes: serializeEnumList(raw.AssociationFeeIncludes),
    associationAmenities: serializeEnumList(raw.AssociationAmenities),
    taxAnnualAmount: real(raw.TaxAnnualAmount),
    taxYear: int(raw.TaxYear),
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
export async function upsertRawListings(
  rawRecords: Raw[],
  opts: { galleries?: boolean } = {},
): Promise<number> {
  // When false (the feed-wide primary pass), don't touch idx_listing_photos at
  // all — we only fetched the primary photo, so there's no gallery to store and
  // we must not clobber galleries a later gallery pass writes. The primary photo
  // still lands on idx_listings.photoUrl via mapRealcompListing either way.
  const storeGalleries = opts.galleries ?? true;
  const mapped: NewIdxListing[] = [];
  const photosByListing = new Map<string, NewIdxListingPhoto[]>();

  for (const raw of rawRecords) {
    const row = mapRealcompListing(raw);
    if (!row) continue;
    mapped.push(row);
    if (!storeGalleries) continue;
    // Store the full photo gallery only for gallery-eligible statuses (Active +
    // Active Under Contract). §18.10 restricts pending/sold to the primary
    // photo, which already lives on idx_listings.photoUrl, so we don't store
    // their galleries. Registering a fetched non-gallery listing with an EMPTY
    // set means replacePhotos deletes any gallery it still has, so photos
    // "follow" the status: a listing going Active→Pending loses its gallery on
    // the next sync, and Pending→Active gets it back (Media is in every
    // incremental fetch). Huge storage win — the Closed-dominated feed no longer
    // writes millions of unusable rows.
    if (Array.isArray(raw.Media)) {
      const photos = showsFullGallery(row.standardStatus)
        ? extractPhotos(raw).map((p) => ({
            listingKey: row.listingKey,
            mediaUrl: p.url,
            sortOrder: p.order,
            mediaCategory: p.category,
          }))
        : [];
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

/** Displayable-status clause (Active / Active Under Contract / Pending / Closed). */
function displayableStatusClause(): string {
  return `(${DISPLAYABLE_STANDARD_STATUSES.map((s) => enumEq('StandardStatus', s)).join(' or ')})`;
}

// Page-streaming fetch (see lib/realcomp.ts realcompFetchPages): invokes onPage
// for each OData page instead of buffering the whole result set. The incremental
// sync upserts each page as it arrives so a run cut short by the serverless time
// budget still persists progress.
type FetchPagesFn = (
  path: string,
  params: Record<string, string>,
  onPage: (page: Raw[]) => Promise<void>,
) => Promise<number>;

// Serverless invocations (the hourly cron + the admin "Run now") are capped at
// ~60s (route maxDuration). Stop FETCHING new pages once this soft budget is
// spent so the log write + metrics recompute still run before the platform hard-
// kills the function. A run stopped here has already upserted every page it
// pulled, so the work isn't lost; the next run continues from the advanced
// cursor. This is what lets a backlog make progress across runs instead of every
// run timing out and saving nothing.
const SYNC_FETCH_BUDGET_MS = 45_000;

// Thrown from an onPage callback to stop pagination once the budget is spent.
// Caught in runIdxSync and treated as a clean partial run (not a failure).
class SyncBudgetReached extends Error {}

/**
 * Incremental query params. Deliberately NO `$orderby`: sorting server-side times
 * the request out on a large delta (the exact footgun §2.8 avoids for the
 * backfill), and it would exceed the serverless budget before the first page
 * even returns. Pages arrive in the feed's default order and are upserted as they
 * land; the max-timestamp cursor advances toward "now" across runs. A run cut
 * short by the budget may re-fetch some already-seen records next time (an
 * idempotent upsert — harmless); a very large backlog is cleared with the
 * dedicated IDX Initial Sync workflow, while this keeps current data fresh.
 */
function incrementalParams(filter: string): Record<string, string> {
  return {
    $select: SELECT_FIELDS,
    $expand: MEDIA_EXPAND,
    $filter: filter,
  };
}

// ---------------------------------------------------------------------------
// Sync entrypoints
// ---------------------------------------------------------------------------
export interface SyncResult {
  query1Fetched: number;
  query1Upserted: number;
  query2Fetched: number;
  query2Upserted: number;
  /** True when the time budget stopped the run mid-backlog (resumes next run). */
  truncated: boolean;
}

/**
 * Hourly incremental sync (IDX spec §2.6). Runs Query 2 (all Active/Pending/
 * Closed, feed-wide) then Query 1 (your offices, all statuses), both filtered by
 * ModificationTimestamp since the last cursor, upserting page-by-page under a
 * wall-clock budget so a backlog too big for one serverless invocation makes
 * progress across successive runs instead of timing out and saving nothing.
 * Logs a idx_sync_log row.
 */
export async function runIdxSync(fetchPages: FetchPagesFn): Promise<SyncResult> {
  const [logRow] = await db
    .insert(idxSyncLog)
    .values({ syncStartedAt: new Date(), status: 'running' })
    .returning({ id: idxSyncLog.id });
  const logId = logRow.id;

  try {
    const cursor = await getSyncCursor();
    const sinceClause = cursor ? `ModificationTimestamp gt ${cursor}` : `ModificationTimestamp gt ${oneYearAgoIso()}`;
    const deadline = Date.now() + SYNC_FETCH_BUDGET_MS;

    let q1Fetched = 0;
    let q1Upserted = 0;
    let q2Fetched = 0;
    let q2Upserted = 0;
    let truncated = false;

    // A single query, streamed: upsert each page as it lands and stop once the
    // budget is spent. Returns false when the budget cut it short.
    const streamQuery = async (filter: string, onCount: (fetched: number, upserted: number) => void): Promise<boolean> => {
      try {
        await fetchPages('Property', incrementalParams(filter), async (page) => {
          onCount(page.length, await upsertRawListings(page));
          if (Date.now() >= deadline) throw new SyncBudgetReached();
        });
        return true;
      } catch (err) {
        if (err instanceof SyncBudgetReached) return false;
        throw err;
      }
    };

    // Query 2 FIRST — the feed-wide pull is the big one and the reason a run can
    // exceed the budget. Draining it before Query 1 spends the whole budget on
    // the query most likely to need it; Query 1 (a tiny office-only set) runs
    // only once Query 2 has fully caught up this run.
    truncated = !(await streamQuery(`${displayableStatusClause()} and ${sinceClause}`, (f, u) => {
      q2Fetched += f;
      q2Upserted += u;
    }));

    // Query 1 — your offices, all statuses that changed (only once Query 2 has
    // fully caught up this run). Office keys are split into URL-length-safe
    // batches (IIS's ~2KB query-string cap) across the four office-key fields.
    if (!truncated) {
      for (const filter of officeFilterBatches(sinceClause, MEDIA_EXPAND)) {
        const done = await streamQuery(filter, (f, u) => {
          q1Fetched += f;
          q1Upserted += u;
        });
        if (!done) {
          truncated = true;
          break;
        }
      }
    }

    // Recompute brokerage metrics from the IDX feed (guarded — no-op until the
    // office sold-backfill has run). Skip it mid-backlog: it's a DB-heavy pass
    // and skipping leaves the whole budget for the next run's fetch. Never fail
    // the sync on a metrics error.
    if (!truncated) {
      try {
        const { updateMetricsFromIdx } = await import('./idxMetrics');
        await updateMetricsFromIdx();
      } catch (err) {
        console.error('[idxSync] updateMetricsFromIdx failed:', err);
      }
    }

    await db
      .update(idxSyncLog)
      .set({
        syncCompletedAt: new Date(),
        // 'partial' = progressed but not caught up; the admin treats it as a
        // (non-failing) success and the next hourly run resumes the backlog.
        status: truncated ? 'partial' : 'success',
        query1RecordsFetched: q1Fetched,
        query1RecordsUpserted: q1Upserted,
        query2RecordsFetched: q2Fetched,
        query2RecordsUpserted: q2Upserted,
      })
      .where(eq(idxSyncLog.id, logId));

    return { query1Fetched: q1Fetched, query1Upserted: q1Upserted, query2Fetched: q2Fetched, query2Upserted: q2Upserted, truncated };
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

// ---------------------------------------------------------------------------
// Resumable backfill (IDX spec §2.8) — CHUNKED by month, resume = per-job "done"
// ---------------------------------------------------------------------------
/**
 * A backfill unit of work with FIXED params (no server-side `$orderby` — ordering
 * a huge RESO result set forces an expensive sort that times the request out).
 * Instead the feed-wide pull is split into bounded MONTH windows; each window is
 * a job whose completion is recorded in idx_backfill_checkpoints. A failed run
 * re-runs only the windows not yet marked done, so progress is preserved without
 * needing an in-query cursor.
 */
export interface BackfillJob {
  key: string;
  /** Whether this pass stores full photo galleries (full Media) or just the
   *  primary photo (light Media). */
  galleries: boolean;
  params: Record<string, string>;
}

/** The last `count` UTC month windows (oldest → newest), as [startIso, endIso). */
function monthWindows(count: number): { label: string; startIso: string; endIso: string }[] {
  const now = new Date();
  const out: { label: string; startIso: string; endIso: string }[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    out.push({ label: start.toISOString().slice(0, 7), startIso: start.toISOString(), endIso: end.toISOString() });
  }
  return out;
}

/**
 * The active/feed-wide backfill, as month-windowed jobs (`active:YYYY-MM`, ×12).
 * Each is the whole feed for that month's ModificationTimestamp window, with the
 * FULL Media expand (a nested `$top=1` on Media turned out to be SLOWER — the
 * server sorts+limits media per listing — so we fetch all photos and just store
 * the gallery for gallery-eligible statuses via the `galleries` flag). No
 * `$orderby` (it forces a full sort and times the request out). Each job's
 * completion is recorded so a re-run skips finished windows.
 */
export function activeBackfillJobs(): BackfillJob[] {
  return monthWindows(12).map((w) => ({
    key: `active:${w.label}`,
    galleries: true,
    params: {
      $select: SELECT_FIELDS,
      $expand: MEDIA_EXPAND,
      $filter: `${displayableStatusClause()} and ModificationTimestamp ge ${w.startIso} and ModificationTimestamp lt ${w.endIso}`,
    },
  }));
}

/**
 * The sold job(s): your offices' Closed sales over a CloseDate window. One job
 * per office-key field (URL-length safe). Closed listings only show the primary
 * photo (§18.10), so `galleries: false` (no gallery storage; primary still lands
 * on idx_listings.photoUrl).
 */
export function soldBackfillJobs(startDate: string, endDate: string): BackfillJob[] {
  if (parseOfficeKeys().length === 0) {
    throw new Error('REALCOMP_OFFICE_KEYS is not set — cannot run the sold backfill.');
  }
  const dateClause = `${enumEq('StandardStatus', 'Closed')} and CloseDate ge ${startDate} and CloseDate lt ${endDate}`;
  // Batch office keys so each request stays under IIS's ~2KB query-string cap.
  return officeFilterBatches(dateClause, MEDIA_EXPAND).map((filter, i) => ({
    key: `sold:${startDate}:${endDate}:${i}`,
    galleries: false,
    params: {
      $select: SELECT_FIELDS,
      $expand: MEDIA_EXPAND,
      $filter: filter,
    },
  }));
}

/** Read a job's completion marker (non-null ⇒ that window/pass is already done). */
export async function getBackfillCheckpoint(jobKey: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ ts: idxBackfillCheckpoints.lastModTs })
      .from(idxBackfillCheckpoints)
      .where(eq(idxBackfillCheckpoints.jobKey, jobKey))
      .limit(1);
    return row?.ts ? new Date(row.ts).toISOString() : null;
  } catch (err) {
    console.warn('[idxSync] getBackfillCheckpoint failed:', err);
    return null;
  }
}

/**
 * Mark a job (month window or the gallery pass) complete. Best-effort: if the
 * checkpoint table is missing (migration 0020 not applied), this must NOT fail
 * the backfill — it just runs every window each time (no resume).
 */
export async function setBackfillCheckpoint(jobKey: string, iso: string): Promise<void> {
  try {
    const ts = new Date(iso);
    await db
      .insert(idxBackfillCheckpoints)
      .values({ jobKey, lastModTs: ts, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: idxBackfillCheckpoints.jobKey,
        set: { lastModTs: ts, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn('[idxSync] setBackfillCheckpoint failed (resume disabled):', err);
  }
}

/** Clear a job's checkpoint (on successful completion, or a forced restart). */
export async function clearBackfillCheckpoint(jobKey: string): Promise<void> {
  try {
    await db.delete(idxBackfillCheckpoints).where(eq(idxBackfillCheckpoints.jobKey, jobKey));
  } catch (err) {
    console.warn('[idxSync] clearBackfillCheckpoint failed:', err);
  }
}
