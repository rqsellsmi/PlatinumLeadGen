import { formatCurrency, formatNumber } from '@/lib/utils';
import type { CityMarketStats12mo } from '@/lib/idx';

export interface OurCityStats {
  avgSalePrice: number | null;
  daysToSell: number | null;
  percentAboveList: number | null;
  homesSold: number | null;
}

interface CityMarketStatsProps {
  cityName: string;
  /** Whole-city figures, trailing 12 months. The headline numbers. */
  market: CityMarketStats12mo | null;
  /**
   * RE/MAX Platinum's own figures for the same window. Pass null when there is
   * too little local business for a comparison to mean anything — the cards then
   * render as plain market figures.
   */
  ours: OurCityStats | null;
}

/**
 * The city market card row.
 *
 * Three cards are WHOLE-CITY metrics; the fourth is our own production. Every
 * card ends in a bar of the same height, but it only carries text when our figure
 * BEAT the market figure above it. Otherwise it is an empty spacer.
 *
 * That emptiness is deliberate. The bar first read "{City} market · All recorded
 * sales", which in a city where we win nothing printed three identical captions in
 * a row, each wrapping onto two lines. The sentence under the row already says
 * where the numbers come from, so repeating it per card was noise. Dropping the
 * bar entirely instead would leave the winning cards taller than the rest and the
 * row would jag, hence a spacer rather than nothing.
 *
 * The production card sits LAST because it can never win: it counts our own
 * deals, so it has no market counterpart to beat. Keeping it at the end means red
 * footers group to the left rather than leaving a gap mid-row.
 *
 * "Better" is per-metric, not bigger-is-better: fewer days to sell wins, a higher
 * sale price and a higher above-list share win, and a tie is not a win.
 */
export default function CityMarketStats({ cityName, market, ours }: CityMarketStatsProps) {
  if (!market) return null;

  const win = (mine: number | null, theirs: number | null, lowerIsBetter: boolean): boolean => {
    if (mine == null || theirs == null) return false;
    return lowerIsBetter ? mine < theirs : mine > theirs;
  };

  type Card = {
    value: React.ReactNode;
    label: string;
    /** null renders the spacer bar; a value fills it red. */
    footer: { value: string; delta: string } | null;
  };

  const cards: Card[] = [
    {
      value: formatCurrency(market.avgSalePrice),
      label: 'Average sale price',
      footer: win(ours?.avgSalePrice ?? null, market.avgSalePrice, false)
        ? {
            value: formatCurrency(ours!.avgSalePrice),
            delta: `▲ ${formatCurrency(ours!.avgSalePrice! - market.avgSalePrice!)}`,
          }
        : null,
    },
    {
      value:
        market.daysToSell != null ? (
          <>
            {formatNumber(market.daysToSell)}{' '}
            <span className="text-[0.45em] font-semibold text-mute-lighter">days</span>
          </>
        ) : (
          '—'
        ),
      label: 'Average days to sell',
      footer: win(ours?.daysToSell ?? null, market.daysToSell, true)
        ? {
            value: `${formatNumber(ours!.daysToSell)} days`,
            // Down is the win here: fewer days on market.
            delta: `▼ ${formatNumber(market.daysToSell! - ours!.daysToSell!)}`,
          }
        : null,
    },
    {
      value:
        market.percentAboveList != null ? (
          <>
            {market.percentAboveList}
            <span className="text-platinum-red">%</span>
          </>
        ) : (
          '—'
        ),
      label: 'Sold above list price',
      footer: win(ours?.percentAboveList ?? null, market.percentAboveList, false)
        ? {
            value: `${ours!.percentAboveList}%`,
            // POINTS, not percent: 39% vs 37% is a 2-point gap, not a 2% one.
            delta: `▲ ${ours!.percentAboveList! - market.percentAboveList!} pts`,
          }
        : null,
    },
    {
      value: formatNumber(ours?.homesSold ?? null),
      label: `Homes sold by us in ${cityName}`,
      footer: null,
    },
  ];

  return (
    <section className="bg-charcoal">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-platinum-red">
          {cityName} · Last 12 Months
        </p>
        <h2 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
          The {cityName} Market
        </h2>

        <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <div
              key={c.label}
              className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
            >
              <div className="flex-1 px-5 pb-5 pt-6">
                <dd className="font-numeric text-4xl font-bold leading-none text-white sm:text-5xl">
                  {c.value}
                </dd>
                <dt className="mt-2 text-sm font-semibold text-white/90">{c.label}</dt>
              </div>
              {/* Same height either way, so the row of cards stays level. */}
              <div
                className={`flex min-h-[2.6rem] items-center justify-between gap-2 px-4 py-2 ${
                  c.footer ? 'bg-platinum-red text-white' : 'bg-white/[0.06]'
                }`}
              >
                {c.footer ? (
                  <>
                    <span className="whitespace-nowrap text-xs font-bold">Our sellers</span>
                    <span className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap font-numeric text-base font-bold leading-none">
                        {c.footer.value}
                      </span>
                      {/* White on red rather than green: green against this red is
                          the hardest pairing to read for red-green colour
                          blindness, and white out-contrasts it here anyway. */}
                      <span className="whitespace-nowrap rounded bg-white px-1.5 py-1 font-numeric text-[11px] font-black leading-none text-platinum-red">
                        {c.footer.delta}
                      </span>
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-sm text-mute-light">
          All figures cover the last 12 months. Market figures are every recorded {cityName} sale;
          RE/MAX Platinum figures are our own closed transactions. A red bar marks where we beat the
          market.
        </p>
      </div>
    </section>
  );
}
