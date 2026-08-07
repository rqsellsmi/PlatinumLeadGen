import { formatCurrency, formatNumber } from '@/lib/utils';

export interface StatComparison {
  /** Whose figures these are, e.g. "RE/MAX Platinum". */
  label: string;
  avgSalePrice: number | null;
  daysToSell: number | null;
  percentAboveList: number | null;
}

interface MarketStatsBarProps {
  avgSalePrice: number | null;
  daysToSell: number | null;
  homesSold: number | null;
  percentAboveList: number | null;
  /** Label for the homes-sold tile. Defaults to the whole-market phrasing. */
  homesSoldLabel?: string;
  /**
   * Our own figures for the same window, shown under a tile ONLY where they beat
   * the headline number. Omit to render a plain bar (the homepage does).
   */
  compare?: StatComparison | null;
  /** Caption below the bar — the place to state the window and the sources. */
  subtext?: string | null;
}

/**
 * Dark headline stat bar (design mockup §2): four big Barlow numbers on charcoal,
 * with the "% above list" figure accented in Platinum Red.
 *
 * On city pages the three market metrics are WHOLE-CITY figures and the fourth is
 * our own production, which is why the homes-sold tile takes its own label. The
 * homepage passes brokerage-wide numbers with no comparison and renders as before.
 *
 * "Better" is per-metric, not a bigger-is-better sweep: a lower days-to-sell wins,
 * a higher sale price and a higher above-list share win. A tie is not a win and
 * shows nothing.
 */
export default function MarketStatsBar({
  avgSalePrice,
  daysToSell,
  homesSold,
  percentAboveList,
  homesSoldLabel = 'Homes Sold — Last 12 Months',
  compare,
  subtext,
}: MarketStatsBarProps) {
  const hasAny =
    avgSalePrice != null ||
    daysToSell != null ||
    (homesSold != null && homesSold > 0) ||
    percentAboveList != null;
  if (!hasAny) return null;

  /** Ours, rendered only when it genuinely beats the market figure. */
  const better = (
    ours: number | null,
    market: number | null,
    lowerIsBetter: boolean,
    format: (n: number) => string,
  ): string | null => {
    if (!compare || ours == null || market == null) return null;
    const wins = lowerIsBetter ? ours < market : ours > market;
    return wins ? `${compare.label}: ${format(ours)}` : null;
  };

  const blocks: { label: string; value: React.ReactNode; note: string | null }[] = [
    {
      label: 'Average Sale Price',
      value: formatCurrency(avgSalePrice),
      note: better(compare?.avgSalePrice ?? null, avgSalePrice, false, (n) => formatCurrency(n)),
    },
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
      note: better(compare?.daysToSell ?? null, daysToSell, true, (n) => `${formatNumber(n)} days`),
    },
    { label: homesSoldLabel, value: formatNumber(homesSold), note: null },
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
      note: better(compare?.percentAboveList ?? null, percentAboveList, false, (n) => `${n}%`),
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
              {b.note ? (
                <p className="mt-1.5 text-xs font-bold text-platinum-red">{b.note}</p>
              ) : null}
            </div>
          ))}
        </dl>
        {subtext ? <p className="mt-9 text-center text-sm text-mute-light">{subtext}</p> : null}
      </div>
    </section>
  );
}
