import type { HomepageAggregateStats } from '@/lib/queries';
import { formatNumber } from '@/lib/utils';

function compactUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/**
 * Dark, aggregate business-metrics bar for the homepage (Homes Sold, Closed
 * Volume, Local Agents, Avg Client Rating). All figures are computed from the
 * database; the whole bar hides if there's nothing meaningful to show yet.
 */
export default function HomeMetricsBar({ stats }: { stats: HomepageAggregateStats }) {
  const blocks: { value: React.ReactNode; label: string }[] = [];

  if (stats.homesSold) blocks.push({ value: formatNumber(stats.homesSold), label: 'Homes Sold' });
  if (stats.closedVolume)
    blocks.push({ value: compactUsd(stats.closedVolume), label: 'In Closed Volume' });
  if (stats.localAgents)
    blocks.push({ value: formatNumber(stats.localAgents), label: 'Local Agents' });
  if (stats.avgRating != null)
    blocks.push({
      value: (
        <>
          {stats.avgRating.toFixed(1)}
          <span className="text-platinum-red">★</span>
        </>
      ),
      label: 'Avg Client Rating',
    });

  if (blocks.length === 0) return null;

  return (
    <section className="bg-charcoal">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:py-14">
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
      </div>
    </section>
  );
}
