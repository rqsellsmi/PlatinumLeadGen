import type { MarketStat } from '@/drizzle/schema';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface MarketStatsBarProps {
  stats: MarketStat | null;
  cityName: string;
  homesSold: number;
}

/** Four headline stat blocks (Section 4.3 #3). Renders nothing when stats is null. */
export default function MarketStatsBar({ stats, cityName, homesSold }: MarketStatsBarProps) {
  if (!stats) return null;

  const blocks = [
    { label: 'Average Sale Price', value: formatCurrency(stats.avgSalePrice) },
    {
      label: 'Average Days to Sell',
      value: stats.daysToSell != null ? formatNumber(stats.daysToSell) : '—',
    },
    { label: 'Homes Sold This Year', value: formatNumber(homesSold) },
    {
      label: '% Sold Above List Price',
      value: stats.percentAboveList != null ? `${stats.percentAboveList}%` : '—',
    },
  ];

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {blocks.map((b) => (
            <div
              key={b.label}
              className="rounded-card border border-line bg-cream px-4 py-6 text-center"
            >
              <dd className="font-numeric text-3xl font-bold text-charcoal sm:text-4xl">{b.value}</dd>
              <dt className="mt-2 text-sm font-semibold text-mute">{b.label}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-center text-sm text-mute-light">
          Based on {formatNumber(homesSold)} homes sold in {cityName} over the last 12 months.
        </p>
      </div>
    </section>
  );
}
