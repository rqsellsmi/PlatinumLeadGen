import type { CityMarketReport } from '@/lib/idx';
import { formatCompactCurrency } from '@/lib/utils';
import Logo from '@/components/Logo';

/**
 * Market Report — the designed brokerage-style report card (IDX spec §5.2 §4).
 * Headline median + year-over-year, a stat rail, an AI-written human summary,
 * and a trailing-12-month median-price bar chart. Computed from idx_listings.
 * Renders nothing when there is no meaningful data.
 */
export default function MarketReport({
  report,
  cityName,
  narrative,
}: {
  report: CityMarketReport | null;
  cityName: string;
  narrative?: string | null;
}) {
  if (!report) return null;
  const hasAny =
    report.medianSalePrice != null ||
    report.homesSold90d > 0 ||
    report.activeListings > 0 ||
    report.trailing.some((t) => t.median != null);
  if (!hasAny) return null;

  const where = cityName || report.city || 'your area';
  const yoy = report.yoyChangePct;
  const change = report.trailing12ChangeAbs;
  const maxMedian = Math.max(1, ...report.trailing.map((t) => t.median ?? 0));
  const firstLabel = report.trailing[0]?.label;
  const lastLabel = report.trailing[report.trailing.length - 1]?.label;

  const stats: { label: string; value: string; accent?: boolean }[] = [];
  if (report.medianPricePerSqft != null)
    stats.push({ label: 'Median $/sq ft', value: `$${report.medianPricePerSqft}` });
  if (report.avgDaysOnMarket != null)
    stats.push({ label: 'Avg days on market', value: String(report.avgDaysOnMarket) });
  if (report.listToSaleRatio != null)
    stats.push({ label: 'List-to-sale ratio', value: `${report.listToSaleRatio}%` });
  stats.push({ label: 'Homes sold (90d)', value: String(report.homesSold90d) });
  if (report.soldAboveAskingPct != null)
    stats.push({ label: 'Sold above asking', value: `${report.soldAboveAskingPct}%`, accent: true });

  return (
    <section className="overflow-hidden rounded-card border border-line bg-white p-6 sm:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-platinum-red">
            The {where} Market · {report.periodLabel}
          </p>
          <h2 className="mt-1 text-3xl font-black uppercase tracking-tight text-charcoal sm:text-4xl">
            Market Report
          </h2>
        </div>
        <Logo variant="blue" href={null} width={104} className="mt-1 shrink-0" />
      </div>
      <hr className="mt-4 border-charcoal/80" />

      {/* Body: headline + narrative | stat rail */}
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-mute-light">
            Median sale price
          </p>
          <p className="mt-1 font-numeric text-6xl font-black leading-none text-charcoal">
            {formatCompactCurrency(report.medianSalePrice)}
          </p>
          {yoy != null ? (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded bg-platinum-blue px-3 py-1.5 text-xs font-bold text-white">
              <span aria-hidden>{yoy >= 0 ? '▲' : '▼'}</span>
              {Math.abs(yoy)}% year over year
            </span>
          ) : null}
          {narrative ? (
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-platinum-blue">{narrative}</p>
          ) : null}
        </div>

        <dl className="lg:border-l lg:border-line lg:pl-8">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`flex items-center justify-between py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
            >
              <dt className="text-sm text-charcoal">{s.label}</dt>
              <dd
                className={`font-numeric text-xl font-bold ${s.accent ? 'text-platinum-red' : 'text-charcoal'}`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Trailing 12-month median price */}
      <hr className="mt-8 border-charcoal/80" />
      <div className="mt-5 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-charcoal">
          Median Price · Trailing 12 Months
        </p>
        {change != null ? (
          <p className="text-sm font-bold text-platinum-blue">
            {change >= 0 ? '+' : '-'}
            {formatCompactCurrency(Math.abs(change))}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex h-40 items-end gap-1.5 sm:gap-2">
        {report.trailing.map((t, i) => {
          const isLast = i === report.trailing.length - 1;
          const pct = t.median != null ? Math.max(6, Math.round((t.median / maxMedian) * 100)) : 3;
          return (
            <div
              key={`${t.label}-${i}`}
              className={`flex-1 rounded-t ${isLast ? 'bg-platinum-red' : 'bg-line-hair'} ${
                t.median == null ? 'opacity-40' : ''
              }`}
              style={{ height: `${pct}%` }}
              title={t.median != null ? `${t.label}: ${formatCompactCurrency(t.median)}` : t.label}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-mute-light">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>

      {/* Source footer */}
      <p className="mt-6 text-[11px] leading-relaxed text-mute-lighter">
        Source: Realcomp II MLS, {where} area. Prepared by RE/MAX Platinum · {report.periodLabel}.
      </p>
    </section>
  );
}
