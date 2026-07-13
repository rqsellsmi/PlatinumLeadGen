import { formatCurrency, formatNumber } from '@/lib/utils';

interface MarketStatsBarProps {
  avgSalePrice: number | null;
  daysToSell: number | null;
  homesSold: number | null;
  percentAboveList: number | null;
  /** Optional caption below the bar, e.g. "Based on N homes sold …". */
  subtext?: string | null;
}

/**
 * Dark headline stat bar (design mockup §2): four big Barlow numbers on
 * charcoal, with the "% above list" figure accented in Platinum Red. Shared by
 * the city pages (per-location market_stats) and the homepage (brokerage-wide
 * home_page_metrics) so both show the same metrics. Renders nothing when there's
 * no meaningful data.
 */
export default function MarketStatsBar({
  avgSalePrice,
  daysToSell,
  homesSold,
  percentAboveList,
  subtext,
}: MarketStatsBarProps) {
  const hasAny =
    avgSalePrice != null ||
    daysToSell != null ||
    (homesSold != null && homesSold > 0) ||
    percentAboveList != null;
  if (!hasAny) return null;

  const blocks: { label: string; value: React.ReactNode }[] = [
    { label: 'Average Sale Price', value: formatCurrency(avgSalePrice) },
    {
      label: 'Average Days to Sell',
      value:
        daysToSell != null ? (
          <>
            {formatNumber(daysToSell)}{' '}
            <span className="text-[0.45em] font-semibold text-mute-lighter">days</span>
          </>
        ) : (
          '—'
        ),
    },
    { label: 'Homes Sold This Year', value: formatNumber(homesSold) },
    {
      label: '% Sold Above List Price',
      value:
        percentAboveList != null ? (
          <>
            {percentAboveList}
            <span className="text-platinum-red">%</span>
          </>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <section className="bg-charcoal">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
        <dl className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {blocks.map((b) => (
            <div key={b.label} className="text-center">
              <dd className="font-numeric text-5xl font-bold leading-none text-white sm:text-6xl">
                {b.value}
              </dd>
              <dt className="mt-2 text-sm font-semibold tracking-wide text-mute-lighter">
                {b.label}
              </dt>
            </div>
          ))}
        </dl>
        {subtext ? (
          <p className="mt-9 text-center text-sm text-mute-light">{subtext}</p>
        ) : null}
      </div>
    </section>
  );
}
