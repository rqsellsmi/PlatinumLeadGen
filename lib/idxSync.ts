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
import { realcompProbe, realcompProbeBody, realcompProbeCount, realcompFetchPages } from './realcomp';
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
export const SELECT_FIELDS_ARR = [
  'ListingKey', 'ListingId', 'ListOfficeMlsId', 'BuyerOfficeMlsId',
  'CoListOfficeMlsId', 'CoBuyerOfficeMlsId', 'MlsStatus', 'StandardStatus', 'ListPrice', 'ClosePrice',
  'CloseDate', 'DaysOnMarket', 'CumulativeDaysOnMarket', 'OriginalListPrice',
  'PropertyType', 'PropertySubType', 'StreetNumber', 'StreetName', 'StreetSuffix',
  'StreetDirPrefix', 'StreetDirSuffix', 'UnitNumber', 'UnparsedAddress', 'City',
  'PostalCity', 'OriginalCity', 'OriginalPostalCity', 'CountyOrParish',
  'SubdivisionName', 'MLSAreaMajor', 'StateOrProvince', 'PostalCode', 'Latitude',
  'Longitude', 'BedroomsTotal', 'BathroomsTotalInteger', 'BathroomsFull',
  'BathroomsHalf', 'LivingArea', 'YearBuilt', 'LotSizeAcres',
  'ListOfficeName', 'ListOfficePhone', 'OriginatingSystemName', 'ModificationTimestamp',
  'VirtualTourURLUnbranded', 'PublicRemarks', 'GarageSpaces', 'Basement',
  'ElementarySchoolDistrict', 'HighSchoolDistrict', 'WaterfrontYN', 'WaterfrontFeatures',
  'WaterBodyName', 'WaterFrontageFeet', 'InternetAddressDisplayYN',
  'InternetEntireListingDisplayYN',
  // Buyer-relevant "data sheet" fields (0021). Enum multi-values (Heating,
  // Cooling, ExteriorFeatures, …) come back as arrays and are serialized to
  // comma lists; scalars map straight through.
  'Levels', 'StoriesTotal', 'RoomsTotal', 'Heating', 'Cooling',
  'FireplacesTotal', 'FireplaceFeatures', 'LaundryFeatures',
  'ExteriorFeatures', 'Flooring', 'ConstructionMaterials', 'Roof',
  'FoundationDetails', 'AttachedGarageYN', 'PoolPrivateYN',
  'PoolFeatures', 'PatioAndPorchFeatures', 'LotSizeDimensions', 'View',
  'WaterSource', 'Sewer', 'Utilities', 'NewConstructionYN', 'Zoning', 'AssociationYN',
  'AssociationFee', 'AssociationFeeFrequency', 'AssociationFeeIncludes',
  // Realcomp's live $metadata declares TaxAnnualAmount but NOT TaxYear (verified
  // via scripts/idx-verify-metadata.ts). Selecting a field the feed doesn't
  // declare makes Realcomp 400 the whole query, so TaxYear is omitted here. The
  // taxYear column + mapping stay (harmless null; picks it up automatically if
  // Realcomp ever adds the field) and the listing page hides the year when null.
  'TaxAnnualAmount',
  // EXCLUDED — these are in $metadata (they pass idx:verify) but Realcomp returns
  // ZERO rows (HTTP 200 + a phantom @odata.nextLink, no 400) for ANY query that
  // $selects them, even alone with the anchor fields. Pinpointed by
  // probeSelectFindAllBad() (lib/idxSync.ts) — see docs/lessons-learned.md §16:
  //   ArchitecturalStyle, InteriorFeatures, Appliances, ParkingFeatures,
  //   LotFeatures, AssociationAmenities.
  // This is why the incremental sync (the first job to run the expanded select)
  // pulled 0 records while the pre-expansion backfill was fine. Their columns +
  // mappings stay (harmless null) so we light up automatically if Realcomp fixes
  // the feed; populating them needs a separate no-select-conflict query (TODO).
  // PhotosCount is also dropped — it only timed out in the audit (not a 0-count),
  // but it's redundant with $expand=Media, so photosCount is derived from the
  // media array instead (see extractRawListing).
] as const;

export const SELECT_FIELDS = SELECT_FIELDS_ARR.join(',');

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
    // Derived from the expanded Media set — PhotosCount is not $selectable
    // without zeroing the query (see SELECT_FIELDS_ARR), and Media gives the
    // real per-listing photo count anyway.
    photosCount: extractPhotos(raw).length,
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

// Default soft budget for the SERVERLESS path (the admin "Run now" server action
// + the /api/cron endpoint), which Vercel hard-kills at ~60s. Stop FETCHING new
// pages once it's spent so the log write + metrics recompute still run before the
// kill. A run stopped here has already upserted every page it pulled, so the work
// isn't lost; the next run continues from the advanced cursor.
//
// The GitHub-runner path (scripts/idx-incremental-sync.ts) passes budgetMs:
// Infinity — it has the runner's multi-hour timeout, so it drains the whole delta
// in one run and never reports 'partial'. Running the sync on the runner instead
// of pinging the 60s Vercel function is why the hourly job stopped 504-ing.
const SYNC_FETCH_BUDGET_MS = 45_000;

// The incremental sync walks forward in bounded time WINDOWS (like the backfill's
// month-windows, §2.8) rather than one open-ended `ModificationTimestamp gt
// cursor` pull. Realcomp appears to materialize the whole filtered+expanded
// result before returning page 1, so an open-ended feed-wide delta (days of the
// entire feed with full Media) made the FIRST request hang past the 5-min request
// timeout — nothing ever streamed. A small window keeps each result set, and its
// first page, small and fast. The checkpoint (idx_backfill_checkpoints, keyed
// below) advances ONLY after a window fully drains, so page-by-page upserts are
// gap-free with no `$orderby`, and a run cut short resumes at the last completed
// window.
const INCREMENTAL_STEP_MS = 60 * 60 * 1000; // 1-hour windows
const INCREMENTAL_CHECKPOINT_KEY = 'incremental';

/**
 * Incremental query params. Deliberately NO `$orderby` (server-side sort times out
 * on a large set — §2.8/§13b); gap-free resume comes from the bounded windows +
 * checkpoint instead. Pages arrive in the feed's default order and are upserted as
 * they land.
 */
function incrementalParams(filter: string): Record<string, string> {
  return {
    $select: SELECT_FIELDS,
    $expand: MEDIA_EXPAND,
    $filter: filter,
  };
}

/**
 * DIAGNOSTIC: fire the EXACT query the incremental sync's first window issues
 * (full $select + status filter + ModificationTimestamp window + Media expand),
 * with a hard timeout — so a hang in the *real* query is caught and bounded
 * instead of running silently for minutes. Logs the filter + status/latency.
 */
export async function probeIncrementalFirstQuery(): Promise<void> {
  const startIso =
    (await getBackfillCheckpoint(INCREMENTAL_CHECKPOINT_KEY)) ?? (await getSyncCursor()) ?? oneYearAgoIso();
  let startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) startMs = Date.parse(oneYearAgoIso());
  const endMs = Math.min(startMs + INCREMENTAL_STEP_MS, Date.now());
  const filter =
    `${displayableStatusClause()} and ModificationTimestamp gt ${new Date(startMs).toISOString()} ` +
    `and ModificationTimestamp le ${new Date(endMs).toISOString()}`;
  console.error(`[probe] first-window window ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);
  console.error(`[probe] first-window filter: ${filter}`);
  await realcompProbe('sync-query', incrementalParams(filter), 60_000);
}

/**
 * DIAGNOSTIC: the sync matches 0 records — figure out WHY by isolating each
 * filter clause. Fires small ($top=5, no media) queries and logs the actual
 * ModificationTimestamps returned:
 *   - newest-5: no filter, newest first → the feed's real max ModificationTimestamp
 *   - ts-only:  ModificationTimestamp gt <since> alone
 *   - status-only: displayable-status alone
 *   - combined: the sync's exact filter
 * Whichever clause turns a non-empty result into count=0 is the culprit.
 */
export async function probeQueryDiagnostics(sinceIso: string): Promise<void> {
  const disp = displayableStatusClause();
  const sel = 'ListingKey,ModificationTimestamp,StandardStatus';
  console.error(`[qdiag] since=${sinceIso}`);
  await realcompProbeBody('newest-5 (no filter, ts desc)', { $select: sel, $orderby: 'ModificationTimestamp desc', $top: '5' }, 20_000);
  await realcompProbeBody('ts-only (gt since)', { $select: sel, $filter: `ModificationTimestamp gt ${sinceIso}`, $top: '5' }, 20_000);
  await realcompProbeBody('status-only', { $select: sel, $filter: disp, $top: '5' }, 20_000);
  await realcompProbeBody('combined (sync filter)', { $select: sel, $filter: `${disp} and ModificationTimestamp gt ${sinceIso}`, $top: '5' }, 20_000);
}

/**
 * DIAGNOSTIC: the filter matches with an OPEN $top query but the windowed sync
 * query returns 0. Isolate which added element ($expand=Media, the full $select,
 * or the narrow gt..le window) zeroes it. Each row prints the record count.
 */
export async function probeMediaDiagnostics(): Promise<void> {
  const disp = displayableStatusClause();
  const sel = 'ListingKey,ModificationTimestamp,StandardStatus';
  const since = '2026-07-10T00:00:00.000Z';
  // A recent hour that should contain records (a 7/17 record showed up earlier).
  const narrow = 'ModificationTimestamp gt 2026-07-17T16:00:00.000Z and ModificationTimestamp le 2026-07-17T17:00:00.000Z';
  const openF = `${disp} and ModificationTimestamp gt ${since}`;
  const narrowF = `${disp} and ${narrow}`;
  await realcompProbeBody('A open, small select, NO media', { $select: sel, $filter: openF, $top: '5' }, 20_000);
  await realcompProbeBody('B open, small select, WITH media', { $select: sel, $expand: MEDIA_EXPAND, $filter: openF, $top: '5' }, 20_000);
  await realcompProbeBody('C narrow, small select, NO media', { $select: sel, $filter: narrowF, $top: '5' }, 20_000);
  await realcompProbeBody('D narrow, small select, WITH media', { $select: sel, $expand: MEDIA_EXPAND, $filter: narrowF, $top: '5' }, 20_000);
  await realcompProbeBody('E open, FULL select, WITH media', { $select: SELECT_FIELDS, $expand: MEDIA_EXPAND, $filter: openF, $top: '5' }, 20_000);
  await realcompProbeBody('F narrow, FULL select, WITH media (== sync req)', { $select: SELECT_FIELDS, $expand: MEDIA_EXPAND, $filter: narrowF, $top: '5' }, 20_000);
}

/**
 * DIAGNOSTIC: the full $select zeroes the query (probeMediaDiagnostics E/F = 0
 * while the 3-field select returns 5). Pinpoint WHY by bisecting SELECT_FIELDS_ARR:
 *   1. anchors-only (control, expect >0)
 *   2. full select (reproduce, expect 0)
 *   3. binary-search the smallest PREFIX of candidate fields that flips >0 → 0
 *   4. test that boundary field ALONE with the anchors:
 *        - alone also 0  → that single field breaks the query (drop it)
 *        - alone still >0 → the failure is CUMULATIVE (query length / field count),
 *          so the offending prefix length is the real limit.
 * Uses an open, media-expanded, $top=5 query so only the $select varies.
 */
export async function probeSelectBisect(): Promise<void> {
  const disp = displayableStatusClause();
  const filter = `${disp} and ModificationTimestamp gt 2026-07-10T00:00:00.000Z`;
  const ANCHORS = ['ListingKey', 'ModificationTimestamp', 'StandardStatus'];
  const candidates = SELECT_FIELDS_ARR.filter((f) => !ANCHORS.includes(f));

  const probe = (label: string, fields: string[]) =>
    realcompProbeCount(label, { $select: fields.join(','), $expand: MEDIA_EXPAND, $filter: filter, $top: '5' }, 20_000);

  console.error(`[qbisect] ${candidates.length} candidate fields beyond anchors`);
  const anchorCount = await probe('anchors-only', ANCHORS);
  const fullCount = await probe(`full select (${SELECT_FIELDS_ARR.length} fields)`, [...SELECT_FIELDS_ARR]);
  if (anchorCount <= 0 || fullCount > 0) {
    console.error(`[qbisect] non-reproducing (anchors=${anchorCount}, full=${fullCount}) — aborting bisection.`);
    return;
  }

  // Smallest k in [1..candidates.length] where ANCHORS + candidates[0..k) => 0.
  let lo = 1;
  let hi = candidates.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const c = await probe(`prefix ${mid} (anchors + first ${mid})`, [...ANCHORS, ...candidates.slice(0, mid)]);
    if (c > 0) lo = mid + 1;
    else hi = mid;
  }
  const boundary = candidates[lo - 1];
  console.error(`[qbisect] boundary at prefix ${lo}: field "${boundary}"`);

  const aloneCount = await probe(`boundary "${boundary}" alone`, [...ANCHORS, boundary]);
  if (aloneCount <= 0) {
    console.error(`[qbisect] VERDICT: field "${boundary}" breaks the query on its own — drop it from SELECT_FIELDS.`);
  } else {
    console.error(
      `[qbisect] VERDICT: "${boundary}" is fine alone (count=${aloneCount}); failure is CUMULATIVE at ${lo} candidate fields ` +
        `(≈${[...ANCHORS, ...candidates.slice(0, lo)].join(',').length} chars of $select). Likely a query-length/field-count limit.`,
    );
  }
}

/**
 * DIAGNOSTIC: probeSelectBisect found ONE bad field (ArchitecturalStyle) but the
 * bisection stops at the first. This tests EVERY candidate field individually
 * (anchors + that one field, media-expanded, $top=5) to list ALL fields that
 * zero the query on their own, then confirms the full select MINUS those fields
 * returns rows. Output: a `DROP=[…]` line to paste into the SELECT_FIELDS cleanup.
 */
export async function probeSelectFindAllBad(): Promise<void> {
  const disp = displayableStatusClause();
  const filter = `${disp} and ModificationTimestamp gt 2026-07-10T00:00:00.000Z`;
  const ANCHORS = ['ListingKey', 'ModificationTimestamp', 'StandardStatus'];
  const candidates = SELECT_FIELDS_ARR.filter((f) => !ANCHORS.includes(f));

  const probe = (label: string, fields: string[]) =>
    realcompProbeCount(label, { $select: fields.join(','), $expand: MEDIA_EXPAND, $filter: filter, $top: '5' }, 20_000);

  console.error(`[qall] testing ${candidates.length} candidate fields individually`);
  const bad: string[] = [];
  for (const f of candidates) {
    const c = await probe(`field ${f}`, [...ANCHORS, f]);
    if (c <= 0) bad.push(f);
  }
  console.error(`[qall] ${bad.length} bad field(s): DROP=[${bad.join(', ')}]`);

  const pruned = SELECT_FIELDS_ARR.filter((f) => !bad.includes(f));
  const prunedCount = await probe(`pruned select (${pruned.length} fields, media)`, [...pruned]);
  console.error(`[qall] pruned select count=${prunedCount} — ${prunedCount > 0 ? 'GOOD (fix = drop those fields)' : 'STILL ZERO (combination effect, needs more work)'}`);
}

/**
 * DIAGNOSTIC: fire the feed-wide first-window query N times (single request each,
 * no internal retry, 15s timeout) to MEASURE how reliably Realcomp serves it —
 * a mix of 200s and aborts = intermittent Realcomp; all aborts = sustained
 * throttle/hang; all 200s = it's reliable now and the earlier failures were
 * transient. Isolates "Realcomp flaky" from "our code".
 */
export async function probeQueryReliability(attempts = 8): Promise<void> {
  const startIso =
    (await getBackfillCheckpoint(INCREMENTAL_CHECKPOINT_KEY)) ?? (await getSyncCursor()) ?? oneYearAgoIso();
  let startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) startMs = Date.parse(oneYearAgoIso());
  const endMs = Math.min(startMs + INCREMENTAL_STEP_MS, Date.now());
  const filter =
    `${displayableStatusClause()} and ModificationTimestamp gt ${new Date(startMs).toISOString()} ` +
    `and ModificationTimestamp le ${new Date(endMs).toISOString()}`;
  console.error(`[rel] firing the feed-wide window query ${attempts}x (single request, 15s timeout each)…`);
  for (let i = 1; i <= attempts; i += 1) {
    await realcompProbe(`rel-${i}`, incrementalParams(filter), 15_000);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * DIAGNOSTIC: run the first window's fetch AND real upsert (the DB write path the
 * bare query probe skips), logging around every write, so a hang in
 * upsertRawListings / setBackfillCheckpoint is pinned to the exact call.
 */
export async function probeFirstWindowUpsert(): Promise<void> {
  const startIso =
    (await getBackfillCheckpoint(INCREMENTAL_CHECKPOINT_KEY)) ?? (await getSyncCursor()) ?? oneYearAgoIso();
  let startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) startMs = Date.parse(oneYearAgoIso());
  const endMs = Math.min(startMs + INCREMENTAL_STEP_MS, Date.now());
  const filter =
    `${displayableStatusClause()} and ModificationTimestamp gt ${new Date(startMs).toISOString()} ` +
    `and ModificationTimestamp le ${new Date(endMs).toISOString()}`;
  console.error(`[probe2] first window ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);

  let n = 0;
  let pageNo = 0;
  await realcompFetchPages('Property', incrementalParams(filter), async (page) => {
    pageNo += 1;
    n += page.length;
    console.error(`[probe2] page ${pageNo}: ${page.length} records — upserting…`);
    const t = Date.now();
    const up = await upsertRawListings(page);
    console.error(`[probe2] page ${pageNo}: upserted ${up} in ${Date.now() - t}ms`);
  });
  console.error(`[probe2] fetch loop done (${n} records) — writing checkpoint…`);
  const tc = Date.now();
  await setBackfillCheckpoint(INCREMENTAL_CHECKPOINT_KEY, new Date(endMs).toISOString());
  console.error(`[probe2] checkpoint written in ${Date.now() - tc}ms — window OK`);
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
 * Pass `budgetMs: Infinity` (the GitHub-runner path) to drain the whole delta in
 * one run. Logs a idx_sync_log row.
 */
export async function runIdxSync(
  fetchPages: FetchPagesFn,
  opts: { budgetMs?: number; sinceIso?: string } = {},
): Promise<SyncResult> {
  const [logRow] = await db
    .insert(idxSyncLog)
    .values({ syncStartedAt: new Date(), status: 'running' })
    .returning({ id: idxSyncLog.id });
  const logId = logRow.id;

  try {
    const budgetMs = opts.budgetMs ?? SYNC_FETCH_BUDGET_MS;
    const deadline = Date.now() + budgetMs;
    const nowMs = Date.now();

    let q1Fetched = 0;
    let q1Upserted = 0;
    let q2Fetched = 0;
    let q2Upserted = 0;
    let truncated = false;

    // Flush running counts to the log row as pages land (throttled), so a run
    // that is killed/aborted mid-stream leaves evidence in the "Recent sync runs"
    // table instead of a frozen `running` with `—/—`. Best-effort: a flush error
    // must not fail the sync.
    let lastFlush = 0;
    const flushProgress = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastFlush < 10_000) return;
      lastFlush = now;
      try {
        await db
          .update(idxSyncLog)
          .set({
            query1RecordsFetched: q1Fetched,
            query1RecordsUpserted: q1Upserted,
            query2RecordsFetched: q2Fetched,
            query2RecordsUpserted: q2Upserted,
          })
          .where(eq(idxSyncLog.id, logId));
      } catch (err) {
        console.warn('[idxSync] progress flush failed:', err);
      }
    };

    // Fetch a filter to exhaustion, upserting each page. Windows keep the result
    // set small, so this returns quickly.
    const drainQuery = async (filter: string, onCount: (fetched: number, upserted: number) => void): Promise<void> => {
      await fetchPages('Property', incrementalParams(filter), async (page) => {
        onCount(page.length, await upsertRawListings(page));
        await flushProgress();
      });
    };

    // Resume point: an explicit `sinceIso` override (a one-time back-pull, e.g.
    // "re-pull from 2026-07-10") wins; else the incremental checkpoint (advanced
    // only after a window fully drains); else the newest ModificationTimestamp we
    // already hold (from the backfill); else a year ago. A sinceIso run still
    // advances the checkpoint as it goes, so subsequent normal runs resume from
    // where it left off.
    let startIso = opts.sinceIso;
    if (!startIso) startIso = (await getBackfillCheckpoint(INCREMENTAL_CHECKPOINT_KEY)) ?? undefined;
    if (!startIso) startIso = (await getSyncCursor()) ?? oneYearAgoIso();
    console.error(`[idxSync] start=${startIso}${opts.sinceIso ? ' (--since override)' : ''}`);
    let windowStartMs = Date.parse(startIso);
    if (Number.isNaN(windowStartMs)) windowStartMs = Date.parse(oneYearAgoIso());
    const rangeStartMs = windowStartMs;

    // Walk forward in bounded windows. Query 2 (feed-wide) per window keeps each
    // request's result — and its first page — small; the checkpoint advances only
    // after a window fully drains, so a run cut short resumes cleanly (no gaps, no
    // $orderby). The runner passes budgetMs: Infinity and drains to `now`; the
    // serverless path stops between windows once its 45s budget is spent.
    while (windowStartMs < nowMs) {
      if (Date.now() >= deadline) {
        truncated = true;
        break;
      }
      const windowEndMs = Math.min(windowStartMs + INCREMENTAL_STEP_MS, nowMs);
      const winClause =
        `ModificationTimestamp gt ${new Date(windowStartMs).toISOString()} ` +
        `and ModificationTimestamp le ${new Date(windowEndMs).toISOString()}`;

      // stderr (unbuffered) window delimiter so the [realcomp] request logs
      // between here and the "done" line are unambiguously THIS window's Query 2.
      console.error(`[idxSync] === Q2 window ${new Date(windowStartMs).toISOString()} → ${new Date(windowEndMs).toISOString()} ===`);
      await drainQuery(`${displayableStatusClause()} and ${winClause}`, (f, u) => {
        q2Fetched += f;
        q2Upserted += u;
      });

      // Whole window drained — record it so the next run resumes here.
      await setBackfillCheckpoint(INCREMENTAL_CHECKPOINT_KEY, new Date(windowEndMs).toISOString());
      windowStartMs = windowEndMs;
      console.error(`[idxSync] === Q2 window done ≤ ${new Date(windowEndMs).toISOString()} — ${q2Fetched} fetched / ${q2Upserted} upserted (cum) ===`);
    }

    // Query 1 — your offices, ALL statuses (Query 2 only covers displayable ones,
    // so this catches office listings that changed to Expired/Withdrawn/etc., for
    // metrics). Offices are a tiny set, so one pull over the whole range advanced
    // this run is small and fast — no windowing needed. Split into URL-length-safe
    // batches (IIS's ~2KB query-string cap) across the four office-key fields.
    if (windowStartMs > rangeStartMs) {
      const q1Clause =
        `ModificationTimestamp gt ${new Date(rangeStartMs).toISOString()} ` +
        `and ModificationTimestamp le ${new Date(windowStartMs).toISOString()}`;
      console.error(`[idxSync] === Q1 (offices) ${new Date(rangeStartMs).toISOString()} → ${new Date(windowStartMs).toISOString()} ===`);
      for (const filter of officeFilterBatches(q1Clause, MEDIA_EXPAND)) {
        await drainQuery(filter, (f, u) => {
          q1Fetched += f;
          q1Upserted += u;
        });
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
