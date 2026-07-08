import type { CityMarketStats } from '@/lib/idx';
import { formatCurrency } from '@/lib/utils';

/**
 * Market Report — city trend stats with a plain-English read (IDX spec §5.2 §4).
 * Computed from idx_listings for the subject property's city. Renders nothing
 * when there is no meaningful data.
 */
export default function MarketReport({
  stats,
  cityName,
}: {
  stats: CityMarketStats | null;
  cityName: string;
}) {
  if (!stats) return null;
  const hasAny =
    stats.medianDaysOnMarket != null ||
    stats.medianSalePrice != null ||
    stats.avgSaleToListRatio != null ||
    stats.activeListings > 0;
  if (!hasAny) return null;

  const moi = stats.monthsOfInventory;
  const market =
    moi == null ? null : moi < 3 ? 'a strong seller’s market' : moi <= 6 ? 'a balanced market' : 'a buyer’s market';
  const interpretation =
    moi != null && market
      ? `With ${moi} months of inventory, ${cityName || 'this area'} is ${market} right now.`
      : stats.avgSaleToListRatio != null
        ? `Homes in ${cityName || 'this area'} are selling at about ${stats.avgSaleToListRatio}% of list price.`
        : null;

  return (
    <section className="mt-10">
      <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
        Market Report
      </p>
      <h3 className="text-2xl font-bold text-charcoal">
        {cityName ? `${cityName} market trends` : 'Local market trends'}
      </h3>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.medianSalePrice != null ? (
          <Stat label="Median sale price" value={formatCurrency(stats.medianSalePrice)} />
        ) : null}
        {stats.medianDaysOnMarket != null ? (
          <Stat label="Median days on market" value={String(stats.medianDaysOnMarket)} />
        ) : null}
        {stats.avgSaleToListRatio != null ? (
          <Stat label="Sale-to-list ratio" value={`${stats.avgSaleToListRatio}%`} />
        ) : null}
        <Stat label="Active listings" value={String(stats.activeListings)} />
        {stats.monthsOfInventory != null ? (
          <Stat label="Months of inventory" value={String(stats.monthsOfInventory)} />
        ) : null}
      </dl>

      {interpretation ? (
        <p className="mt-4 rounded-lg border border-line bg-cream px-4 py-3 text-sm text-charcoal">
          {interpretation}
        </p>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <dd className="font-numeric text-2xl font-bold text-charcoal">{value}</dd>
      <dt className="mt-0.5 text-xs text-mute-light">{label}</dt>
    </div>
  );
}
