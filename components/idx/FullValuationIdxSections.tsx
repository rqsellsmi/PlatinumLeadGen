'use client';

import * as React from 'react';
import type { IdxCard, CityMarketStats } from '@/lib/idx';
import { copyrightNotice } from '@/lib/idxDisclosures';
import IdxListingGrid from './IdxListingGrid';
import MarketReport from './MarketReport';

/**
 * The IDX portion of the Full Valuation page (IDX spec §4–§5): Similar Homes
 * For Sale, Similar Homes Recently Sold, and the Market Report — inserted below
 * the valuation + condition section. Each piece renders nothing when empty, so
 * the page degrades cleanly before the IDX feed is populated.
 */
export default function FullValuationIdxSections({
  forSale,
  sold,
  forSalePhotos,
  marketStats,
  cityName,
}: {
  forSale: IdxCard[];
  sold: IdxCard[];
  forSalePhotos: Record<string, string[]>;
  marketStats: CityMarketStats | null;
  cityName: string;
}) {
  const photoMap = React.useMemo(
    () => new Map(Object.entries(forSalePhotos)),
    [forSalePhotos],
  );

  const nothing = forSale.length === 0 && sold.length === 0 && !marketStats;
  if (nothing) return null;

  return (
    <div>
      <IdxListingGrid
        eyebrow="Currently on the market"
        title="Similar Homes For Sale"
        listings={forSale}
        variant="sale"
        photosByListing={photoMap}
        firstOnPage
      />
      <IdxListingGrid
        eyebrow="Recently sold nearby"
        title="Similar Homes Recently Sold"
        listings={sold}
        variant="sold"
      />
      <MarketReport stats={marketStats} cityName={cityName} />

      {/* Realcomp copyright / MLS credit for the IDX data on this page (§18.3.4). */}
      <p className="mt-8 border-t border-line pt-4 text-[11px] leading-relaxed text-mute-light">
        {copyrightNotice()}
      </p>
    </div>
  );
}
