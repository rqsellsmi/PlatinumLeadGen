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
 * card carries a filled footer whether or not we win, so the cards stay the same
 * height and the row does not reflow depending on which metrics we happen to beat
 * this month. A red footer means our figure beat the market one above it; a
 * neutral footer just names the source.
 *
 * The production card sits LAST because it is the one card that can never turn
 * red: it has no market counterpart to beat, being a count of our own deals
 * rather than a rate or an average. Keeping it at the end means the red footers
 * cluster on the left rather than leaving a gap mid-row.
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
    /** Filled red when we beat the market figure; neutral otherwise. */
    footer: { left: string; right: string; win: boolean };
  };

  const marketFooter = { left: `${cityName} market`, right: 'All recorded sales', win: false };

  const cards: Card[] = [
    {
      value: formatCurrency(market.avgSalePrice),
      label: 'Average sale price',
      footer: win(ours?.avgSalePrice ?? null, market.avgSalePrice, false)
        ? { left: 'RE/MAX Platinum', right: formatCurrency(ours!.avgSalePrice), win: true }
        : marketFooter,
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
            left: 'RE/MAX Platinum',
            right: `${formatNumber(ours!.daysToSell)} days`,
            win: true,
          }
        : marketFooter,
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
        ? { left: 'RE/MAX Platinum', right: `${ours!.percentAboveList}%`, win: true }
        : marketFooter,
    },
    {
      value: formatNumber(ours?.homesSold ?? null),
      label: `Homes sold by us in ${cityName}`,
      // Never red: there is no market counterpart to beat.
      footer: { left: 'RE/MAX Platinum', right: 'Our closed sales', win: false },
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
              <div
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-bold ${
                  c.footer.win ? 'bg-platinum-red text-white' : 'bg-white/[0.06] text-mute-lighter'
                }`}
              >
                <span>{c.footer.left}</span>
                <span className={c.footer.win ? 'font-numeric' : 'font-semibold'}>
                  {c.footer.right}
                </span>
              </div>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-sm text-mute-light">
          All figures cover the last 12 months. Market figures are every recorded {cityName} sale;
          RE/MAX Platinum figures are our own closed transactions.
        </p>
      </div>
    </section>
  );
}
