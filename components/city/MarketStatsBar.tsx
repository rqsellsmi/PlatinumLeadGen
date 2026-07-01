import type { MarketStat } from '@/drizzle/schema';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface MarketStatsBarProps {
  stats: MarketStat | null;
  cityName: string;
  homesSold: number;
}

/**
 * Dark headline stat bar (design mockup §2): four big Barlow numbers on
 * charcoal, with the "% above list" figure accented in Platinum Red.
 * Renders nothing when stats is null.
 */
export default function MarketStatsBar({ stats, cityName, homesSold }: MarketStatsBarProps) {
  if (!stats) return null;

  const blocks: { label: string; value: React.ReactNode }[] = [
    { label: 'Average Sale Price', value: formatCurrency(stats.avgSalePrice) },
    {
      label: 'Average Days to Sell',
      value:
        stats.daysToSell != null ? (
          <>
            {formatNumber(stats.daysToSell)}{' '}
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
        stats.percentAboveList != null ? (
          <>
            {stats.percentAboveList}
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
        <p className="mt-9 text-center text-sm text-mute-light">
          Based on {formatNumber(homesSold)} homes sold in {cityName} over the last 12 months.
        </p>
      </div>
    </section>
  );
}
