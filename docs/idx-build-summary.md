# IDX Feed Integration — Build Summary

Branch: `claude/idx-feed-integration-plan-wqpm0b`. Implements the Realcomp II
RAPI v2.4 (OData) IDX integration per `LeadPlatform_IDX_Spec`, the Realcomp
"Getting Started" guide, and the IDX Rules 2024. Migration head is now
**`0015_idx_integration`**.

## What was built

**Data pipeline (Phases 1–4)**
- Schema (`0015`): `realcomp_tokens`, `idx_listings` (~60 cols incl. compliance
  flags + computed `isOfficeListing`), `idx_listing_photos` (full Media set),
  `idx_sync_log`; `leads.reportToken` / `reportFirstAccessedAt` / `reportViewCount`.
- `lib/realcomp.ts` — OAuth client-credentials token persisted to Neon (single
  row, MS-Graph pattern) + `realcompFetch` / `realcompFetchPages` with
  `@odata.nextLink` pagination + `$metadata` fetch.
- `lib/idxSync.ts` — dual-query incremental sync (Query 1 = office keys, Query 2
  = feed-wide Active/Pending/Closed), defensive field mapping, WaterfrontFeatures
  enum serialization, Media→photos, office-key match, **no stale deactivation**,
  chunked upsert keyed on `listingKey`. 16 unit tests in `tests/idxSync.test.ts`.
- `app/api/cron/idx-sync` (hourly, CRON_SECRET) + `.github/workflows/idx-sync.yml`
  (hourly ping — Vercel Hobby only allows daily crons) + `idx-initial-sync.yml`
  (manual backfill) + `scripts/idx-initial-sync.ts` (streaming) +
  `scripts/idx-verify-metadata.ts` (live `$select` validation).

**Compliance + consumer features (Phases 5–7)**
- `lib/idxDisclosures.ts` (all required disclosure text) + `components/idx/*`
  (RealcompLogo, IdxCompliance, IdxListingCard, IdxListingGrid, MarketReport,
  FullValuationIdxSections). Compliance baked into `lib/idx.ts` queries:
  Active/Pending/Closed only, entire-listing display gate, address gated by
  `internetAddressDisplayYN`; full photo gallery for Active only (§18.10).
- **Full Valuation page** = the enhanced `/thank-you` report: restyled hero
  (headline estimate + confidence up top, range beneath), then Similar Homes
  For Sale, Similar Homes Recently Sold, and the Market Report. Durable report
  token (`lib/reportAccess.ts`) drives the confirmation-email link and the admin
  view log. Both valuation forms redirect here (the city form was fixed — it had
  been reading a non-existent `estimatedValue`).

**Admin + metrics (Phases 8–9)**
- `/admin/idx-sync` (status + "Run Sync Now"), `/admin/idx-listings` (browser),
  `/admin/market-reports` (access log); IDX nav group.
- Metrics repointed to the feed (`lib/idxMetrics.ts` recomputes
  `home_page_metrics` + `market_stats` from office-closed deals; recent-sales
  tiles + homepage volume prefer IDX office listings). **Fallback-safe**: a no-op
  while there are no office-closed listings, so nothing changes until the sold
  backfill runs. Data Upload + Recent Sales are deprecated (removed from nav).

## Owner action items (before public launch)

1. **Set env vars** in Vercel (Production + Preview) **and** GitHub Actions
   secrets: `REALCOMP_CLIENT_ID`, `REALCOMP_CLIENT_SECRET`, `REALCOMP_BASE_URL`
   (`https://idxapi.realcomp.com/odata`), `REALCOMP_AUTH_URL`
   (`https://auth.realcomp.com/token`), `REALCOMP_OFFICE_KEYS` (comma list),
   plus `DATABASE_URL` + `DEPLOY_URL` in GitHub secrets. Per the Realcomp
   account setup sheet the data host is **`https://fullapi.realcomp.com/odata`**
   (not `idxapi`) and the token URL is `https://auth.realcomp.com/Token`.
2. **Apply migration `0015`** on every Neon branch (`npm run db:migrate`).
3. **Verify field names**: `npm run idx:verify` (fetches live `$metadata`; fix
   any flagged field in `lib/idxSync.ts`). See "known unknowns" below.
4. **Run the backfill** from the GitHub Actions "IDX Initial Sync" workflow:
   `active` first, then `sold` year-by-year (2024, 2023, …).
5. **Add the Realcomp-approved logo** at `public/assets/realcomp-logo.png`
   (see `public/assets/README-realcomp-logo.md`).

## Known unknowns to confirm against live `$metadata`

The spec itself flagged these; they are centralized for easy adjustment:
- **StandardStatus enum quoting** in `$filter` — `enumEq()` in `lib/idxSync.ts`
  currently uses single-quoted values; adjust if the enum is namespaced.
- **Office-key `in()` quoting** — `officeFilterClause()` sends keys unquoted
  (numeric); switch to quoted if `$metadata` types them as strings.
- **MLS number field** — mapped from `ListingId` (fallback `MLSNumber`).
- **Media expand** — `Media($select=MediaURL,Order,MediaCategory)`.
- Township has no OData field (stored `null`; geo proxies stored instead).

`runIdxSync` cannot run live from a code-only session (no creds); the first
GitHub Actions backfill + the `/admin/idx-sync` page are the live verification.
