-- Buyer-facing home search performance indexes. The public /homes search filters
-- and the map bounding-box query scan idx_listings on columns that were unindexed
-- (only standard_status, city, county, list_price, close_date, is_office_listing,
-- modification_timestamp had indexes). Add btree indexes for the geo + attribute
-- predicates a buyer search runs. Hand-authored, idempotent (CREATE INDEX IF NOT
-- EXISTS is a no-op if already present, so safe to re-run per Neon branch).

CREATE INDEX IF NOT EXISTS "idx_listings_lat_lng_idx" ON "idx_listings" ("latitude", "longitude");
CREATE INDEX IF NOT EXISTS "idx_listings_beds_idx" ON "idx_listings" ("beds_total");
CREATE INDEX IF NOT EXISTS "idx_listings_baths_idx" ON "idx_listings" ("baths_total");
CREATE INDEX IF NOT EXISTS "idx_listings_living_area_idx" ON "idx_listings" ("living_area");
CREATE INDEX IF NOT EXISTS "idx_listings_year_built_idx" ON "idx_listings" ("year_built");
CREATE INDEX IF NOT EXISTS "idx_listings_dom_idx" ON "idx_listings" ("days_on_market");
