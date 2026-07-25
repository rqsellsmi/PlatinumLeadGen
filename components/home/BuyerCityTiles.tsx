import Link from 'next/link';
import Image from 'next/image';
import type { BuyerCityTile } from '@/lib/buyerHome';

const FALLBACK = '/assets/hero-home-2.jpg';

/**
 * "Browse homes by city" — the 12 near-an-office, most-active mailing cities.
 * Each tile links to the search pre-filtered to that city. Renders nothing when
 * empty (no feed data yet).
 */
export default function BuyerCityTiles({ tiles }: { tiles: BuyerCityTile[] }) {
  if (!tiles.length) return null;

  return (
    <section className="bg-cream">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <h2 className="text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
          Browse homes by city
        </h2>
        <p className="mt-2 text-mute">Explore active listings in the communities we serve.</p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.city}
              href={`/homes?city=${encodeURIComponent(t.city)}`}
              className="group relative flex h-40 items-end overflow-hidden rounded-xl"
            >
              <Image
                src={t.photoUrl ?? FALLBACK}
                alt={t.city}
                width={400}
                height={300}
                unoptimized
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="relative p-4 text-white">
                <p className="text-lg font-bold leading-tight">{t.city}</p>
                <p className="text-sm text-white/90">
                  {t.activeCount.toLocaleString()} {t.activeCount === 1 ? 'home' : 'homes'} for sale
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
