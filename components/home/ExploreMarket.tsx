import Image from 'next/image';
import Link from 'next/link';
import type { CityTile } from '@/lib/queries';
import { formatCurrency } from '@/lib/utils';

const FALLBACK_IMAGE = '/assets/hero-home-2.jpg';

function shortName(name: string): string {
  return name.split(',')[0].trim();
}

/**
 * "Explore Your Market" — image cards per active city that deep-link to each
 * community landing page. Renders nothing when there are no active cities.
 */
export default function ExploreMarket({ cities }: { cities: CityTile[] }) {
  if (!cities.length) return null;

  return (
    <section className="bg-cream">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <p className="text-center text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
          Thinking of selling?
        </p>
        <h2 className="mt-3.5 text-center text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
          Explore Your Market
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-mute">
          Get a free, instant home valuation built from real local sales — then connect with a
          Platinum expert in your community.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {cities.map((c) => (
            <Link
              key={c.slug}
              href={`/sell/${c.slug}`}
              className="group relative isolate flex h-64 flex-col justify-end overflow-hidden rounded-xl"
            >
              <Image
                src={c.photoUrl ?? FALLBACK_IMAGE}
                alt={`Homes in ${shortName(c.name)}`}
                fill
                sizes="(max-width: 640px) 100vw, 25vw"
                className="-z-10 object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div
                aria-hidden
                className="absolute inset-0 -z-10 bg-gradient-to-t from-[rgba(20,20,24,0.85)] via-[rgba(20,20,24,0.3)] to-transparent"
              />
              <div className="p-5 text-white">
                <p className="text-lg font-extrabold">{shortName(c.name)}</p>
                {c.avgSalePrice != null || c.daysToSell != null ? (
                  <p className="mt-0.5 text-xs font-semibold text-white/85">
                    {c.avgSalePrice != null ? `Avg ${formatCurrency(c.avgSalePrice)}` : ''}
                    {c.avgSalePrice != null && c.daysToSell != null ? ' · ' : ''}
                    {c.daysToSell != null ? `${c.daysToSell} days to sell` : ''}
                  </p>
                ) : null}
                <p className="mt-2 text-sm font-bold">See home values →</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
