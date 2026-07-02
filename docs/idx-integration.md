# IDX / MLS Feed Integration — Data-Flow Map & Plan

Status: **planning only** (no code changed). Prepared ahead of an incoming IDX
feed that will rework "recent sales" and "market trends / stats."

## TL;DR

Everything — homepage recent sales, city recent sales, market stats, the
thank-you comps/snapshot, and homepage aggregates — flows from **one table:
`closings`**. Today it is filled by CSV upload. **An IDX feed only replaces the
import stage.** If the feed writes `closings` rows in the same shape and then
triggers the recompute, every downstream page keeps working unchanged.

```
                     ┌──────────────────────────────────────────────┐
  CSV upload  ──▶    │  uploadClosings()  +  parseClosingsCsv()      │  ◀── REPLACE
  (today)           │  → INSERT closings → updateAllMetrics()       │      with IDX sync
                     └───────────────┬──────────────────────────────┘
                                     │
                 ┌───────────────────┼─────────────────────────────┐
                 ▼                   ▼                             ▼
          market_stats        home_page_metrics             closings (read directly)
                 │                   │                             │
   getMarketStats()      getHomepageAggregateStats()   getFeaturedRecentSales()
   (city/ads pages,               (home hero)          getCityRecentSales()
    thank-you snapshot)                                getCityTiles()
                                                        (home + city + thank-you)
```

---

## 1. `closings` table + related tables (`drizzle/schema.ts`)

**`closings`** (`schema.ts:210-241`) — one row per imported transaction, tagged
by side:

| column | notes |
| --- | --- |
| `id` | serial PK |
| `mlsNumber` varchar(50), nullable | dedup key **per `agentRole`**; null = never deduped |
| `agentRole` varchar(20) notNull | `'listing'` \| `'buyer'` — the side. **Supplied by the uploader, NOT from the CSV.** |
| `closeDate` timestamp notNull | drives the trailing-12-month window + recent-sales ordering |
| `listPrice` integer nullable | |
| `salePrice` integer **notNull** | feeds avg sale price + closed volume |
| `daysOnMarket` integer nullable | |
| `address` varchar(500) notNull | |
| `city` varchar(100) nullable | matched against `locations.matchCities` for per-location stats + city tiles |
| `state` varchar(10) notNull default `'MI'` | |
| `zipCode` varchar(20) nullable | stored verbatim; no zip filtering at import |
| `propertyType` varchar(100) notNull default `'Single Family'` | **overloaded** — carries tile-type codes `RS`/`CO` used to filter tiles |
| `agentName` varchar(200) nullable | |
| `schoolDistrict` varchar(200) nullable | indexed; not used by current metrics (which match on city) |
| `percentOfListPrice` real nullable | sale/list ratio as a percentage |
| `photoUrl` varchar(500) nullable | showcase photo on a recent-sales tile |
| `uploadBatchId` integer notNull | FK → `upload_batches`, `onDelete: cascade` |
| `createdAt` timestamp default now | |

Indexes: `closings_mls_role_idx (mlsNumber, agentRole)`, `closings_district_idx`,
`closings_close_date_idx`, `closings_batch_idx`.

**`upload_batches`** (`schema.ts:198-208`) — one row per import run: `agentRole`,
`fileName`, `rowsImported`, `rowsSkipped`, `rowsErrored`, `earliestCloseDate`,
`latestCloseDate`, `createdAt`. Deleting a batch cascade-deletes its closings.

**`market_stats`** (`schema.ts:161-172`) — one current row per location
(`locationId` FK cascade): `avgSalePrice`, `daysToSell`, `homesSold` (12 mo),
`percentOfListPrice`, `percentAboveList`, `updatedAt`. Recomputed from closings.

**`home_page_metrics`** (`schema.ts:279-289`) — single row of homepage
aggregates: `totalHomesSold` (all-time), `avgDaysToSell`, `avgSalePrice`,
`homesSold` (12-mo), `avgPercentOfList`, `pctAboveListPrice`, `updatedAt`.

**`locations.matchCities`** (`schema.ts:144`) — comma-separated mailing cities a
location covers, matched against `closings.city`; null/empty falls back to the
location's short name.

**`recent_sales`** (`schema.ts:177-193`) — legacy/manual table. Per
`lib/metrics.ts:12-13`, tiles are **no longer materialized here**; public pages
read straight from `closings`. Effectively dormant for the current tile flow.

---

## 2. How closings get IN today (the seam to replace)

- **Admin page:** `app/admin/data-upload/page.tsx` → `components/admin/DataUploadClient.tsx` (lists batches newest-first).
- **Server action:** `app/admin/data-upload/actions.ts` → `uploadClosings(agentRole, csvText, fileName)` (`actions.ts:26-112`).
- **Parser:** `lib/csvClosings.ts` → `parseClosingsCsv(text, agentRole)` (`csvClosings.ts:194-254`).

Behaviors an IDX sync must reproduce (or we consciously drop):

- **Header aliases** (`csvClosings.ts:13-35`) — case-insensitive; `city` prefers
  `Mailing City` over `City`; `salePrice` = Sale/Sold/Close Price;
  `percentOfListPrice` includes `RATIO Close Price By List Price`.
- **SOLD-only filter** (`csvClosings.ts:212-213`) — if a Stat/Status column
  exists, any row not `"sold"` (case-insensitive) is skipped.
- **Row validation** (`csvClosings.ts:215-231`) — required `closeDate`,
  `salePrice`, `address`; bad rows skipped with a collected error (import
  continues). Date parsing handles ISO / `MM/DD/YYYY` / free-form.
- **Side (listing vs buyer)** — NOT in the CSV; `agentRole` is chosen in the UI
  and stamped on every row (`csvClosings.ts:242`, validated `actions.ts:32`).
- **MLS dedup** (`actions.ts:40-58`) — loads existing `mlsNumber`s **for that
  same `agentRole`**, skips already-seen (also dedups within the file); null MLS
  never deduped. Same property can exist once as listing and once as buyer.
- **Batch recording** (`actions.ts:62-98`) — one `upload_batches` row with counts
  + close-date range, then bulk-insert closings with `uploadBatchId`.
- **Post-import** (`actions.ts:100-101`) — `updateAllMetrics()` then
  `revalidatePath('/admin/data-upload')`.
- **Batch management** — `getClosingsByBatch`, `deleteBatch` (cascade + recompute),
  `deleteAllClosings` (wipe + `resetAllMetrics`), `recomputeMetrics` button.

**Seam:** replace `parseClosingsCsv` + `uploadClosings`. Anything that writes
`closings` rows (with `agentRole`, `city`, `propertyType`/tile code, `salePrice`,
`closeDate`, `mlsNumber`) and calls `updateAllMetrics()` feeds every downstream
reader unchanged.

---

## 3. Recent sales OUT (`lib/queries.ts`)

- Interface `HomeRecentSale` (`queries.ts:185-193`); `TILE_TYPES = ['RS','CO']`
  (195); `TILE_SELECT` maps `soldPrice←salePrice`, `photoUrl←closings.photoUrl`,
  `cityName←closings.city` (196-204).
- **`getFeaturedRecentSales(limit=6)`** (`queries.ts:210-222`) — home tiles;
  `WHERE agentRole='listing' AND propertyType IN ('RS','CO')`, `ORDER BY closeDate DESC`.
- **`getCityRecentSales(cities, limit=6)`** (`queries.ts:225-245`) — same + covered
  mailing-city filter.
- **`getCityTiles()`** (`queries.ts:256-302`) — per active location: `market_stats`
  + a representative list-side RS/CO photo (city-matched, newest).
- **`locationMatchCities(loc)`** (`queries.ts:35-41`) — covered-city restriction
  used by city sales, tiles, and stats.

Rendered at: home `app/page.tsx:37-38` → `components/home/HomeRecentSales.tsx`;
city `app/sell/[slug]/page.tsx` → `components/city/RecentSales.tsx`; thank-you
report `app/thank-you/page.tsx:50,54` (as "comps"); admin
`app/admin/recent-sales/page.tsx`.

---

## 4. Market stats / trends (`lib/metrics.ts`)

- **`updateAllMetrics()`** (`metrics.ts:72-126`) — called after every import/delete
  and the manual button.
  - **Trailing-12-month window** `WINDOW_DAYS=365` (19); `windowOrAll` falls back to
    all rows if the window is empty (60-65).
  - **Homepage row:** totals all-time (`totalHomesSold = all.length`), averages over
    the window; uses **both** sides.
  - **Per-location `market_stats`:** `matchSet(loc)` (lowercase mailing cities from
    `matchCities`), filter closings by city, skip if zero matched (won't zero out
    existing), upsert one row per location (`metrics.ts:100-122`).
- **Read:** `getMarketStats(locationId)` (`queries.ts:66-79`).
- Rendered at: city `components/city/MarketStatsBar.tsx`; ads
  `app/ads/[slug]/page.tsx:99-111`; city index `app/sell/page.tsx`; thank-you
  snapshot `ThankYouClient.tsx`.
- **Admin override:** `app/admin/locations/[id]/stats/page.tsx` + `saveStats`
  action (manual upsert of the 5 `market_stats` fields, independent of recompute).

**Separate trends source to reconcile:** the thank-you "Local market trends"
block is **not** from `market_stats` — it comes from ATTOM
(`lib/attom.ts:getAttomAreaTrends`, gated by `ATTOM_ENABLE_TRENDS`, keyed off
`valuations.areaGeoId`). An IDX-driven trends rework overlaps this ATTOM path.

---

## 5. Homepage aggregates — `getHomepageAggregateStats()` (`queries.ts:153-183`)

Returns `{ homesSold, closedVolume, localAgents, avgRating, reviewCount }`:
`closedVolume = sum(salePrice)`; `homesSold = home_page_metrics.totalHomesSold`
(fallback: closings count); `localAgents = count(agents)`; `avgRating` /
`reviewCount` from `locations.googleReviewRating` / `googleReviewCount`.
Rendered on the home hero (`app/page.tsx`) + `components/home/HomeMetricsBar.tsx`.

---

## 6. Recent-sales photos

- `closings.photoUrl` (`schema.ts:229`; migration `0005_import_photos.sql`).
- Selected into tiles via `TILE_SELECT.photoUrl`; city-tile picker requires
  `photoUrl is not null`.
- Admin: `app/admin/recent-sales/page.tsx` + `RecentSalePhoto` editor + action
  `updateClosingPhoto` (sets/clears by id, revalidates home + `/sell/[slug]`).
  Photos attached **after** import, keyed on the persisted closing id. An IDX feed
  carrying MLS photo URLs could populate `photoUrl` directly.

---

## Integration seams summary

1. **Primary seam** — `app/admin/data-upload/actions.ts:uploadClosings` +
   `lib/csvClosings.ts`. Replace with IDX sync writing `closings`. Preserve:
   `agentRole` tagging, `propertyType` tile codes `RS`/`CO`, SOLD-only filter, MLS
   dedup per role, and the `updateAllMetrics()` call.
2. **No downstream changes** if the feed populates `closings` the same way: §3–§5
   read from `closings`/`market_stats`/`home_page_metrics`.
3. **Overlap to reconcile** — two "market" paths exist: closings-based
   `market_stats` (city/ads) vs. ATTOM area trends (thank-you). Consolidate to one
   authoritative trends source during the rework.
4. **Manual-override layer** — admin `market_stats` editor + photo editor write
   fields the recompute/import also manage; note the recompute's "don't zero out"
   guard (`metrics.ts:101`).

---

## Open decisions to make when the feed details arrive

1. **Sync semantics** — CSV is append-only + insert. An IDX feed refreshes over
   time (status changes, corrections, removals). We likely want **upsert keyed on
   MLS** plus a way to retire stale rows — a larger change than today's model.
2. **Push vs. pull** — webhook/push vs. scheduled pull (cron). Affects where the
   sync lives (an API route vs. a cron in `app/api/cron/*`).
3. **Side derivation** — does the feed carry listing-vs-buyer side, or do we infer
   `agentRole` from the office/agent on the record?
4. **Tile codes** — how the feed maps to `RS`/`CO` (or whether we change tile
   selection to a real column instead of overloading `propertyType`).
5. **Photos** — use MLS media URLs directly in `closings.photoUrl` (mind MLS
   display/retention rules), or keep the manual admin photo step.
6. **Trends source of truth** — closings-derived `market_stats` vs. ATTOM vs. IDX
   market data; pick one and retire the overlap.
