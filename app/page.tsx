import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getActiveLocations,
  getMarketStats,
  getHomePageMetrics,
  getFeaturedTestimonials,
} from '@/lib/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Badge } from '@/components/ui';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

export const revalidate = 86400;

const SITE_URL = process.env.SITE_URL ?? 'https://remax-platinumonline.com';

export const metadata: Metadata = {
  title: 'Sell Your Michigan Home | RE/MAX Platinum — Local Experts',
  description:
    'RE/MAX Platinum helps Michigan homeowners sell faster and for more money. Get a free, instant home valuation and connect with a local expert who knows your market.',
  alternates: { canonical: SITE_URL },
};

function shortCityName(name: string): string {
  return name.split(',')[0].trim();
}

export default async function HomePage() {
  const [locations, metrics, testimonials] = await Promise.all([
    getActiveLocations(),
    getHomePageMetrics(),
    getFeaturedTestimonials(3),
  ]);

  const cityCards = await Promise.all(
    locations.map(async (location) => ({
      location,
      stats: await getMarketStats(location.id),
    })),
  );

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="bg-gradient-to-br from-brand-blue to-[#16304d] text-white">
          <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:py-32">
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Sell Your Michigan Home Faster — and for More
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-200 sm:text-xl">
              RE/MAX Platinum pairs cutting-edge home valuations with local experts who know your
              neighborhood. Find out what your home is worth today.
            </p>
            <div className="mt-10">
              <Link
                href="/sell"
                className="inline-flex items-center justify-center rounded-md bg-brand-red px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-[#b8141f]"
              >
                Get My Free Home Value
              </Link>
            </div>
          </div>
        </section>

        {/* Overall stats */}
        {metrics ? (
          <section className="bg-white">
            <div className="mx-auto max-w-6xl px-4 py-12">
              <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-brand-light px-4 py-6 text-center">
                  <dd className="text-3xl font-bold text-brand-blue">
                    {formatNumber(metrics.totalHomesSold)}
                  </dd>
                  <dt className="mt-2 text-sm font-medium text-slate-600">Homes Sold</dt>
                </div>
                <div className="rounded-lg border border-slate-200 bg-brand-light px-4 py-6 text-center">
                  <dd className="text-3xl font-bold text-brand-blue">
                    {formatNumber(metrics.avgDaysToSell)}
                  </dd>
                  <dt className="mt-2 text-sm font-medium text-slate-600">Avg. Days to Sell</dt>
                </div>
                <div className="rounded-lg border border-slate-200 bg-brand-light px-4 py-6 text-center">
                  <dd className="text-3xl font-bold text-brand-blue">
                    {formatCurrency(metrics.avgSalePrice)}
                  </dd>
                  <dt className="mt-2 text-sm font-medium text-slate-600">Avg. Sale Price</dt>
                </div>
              </dl>
            </div>
          </section>
        ) : null}

        {/* City cards */}
        {cityCards.length ? (
          <section className="bg-brand-light">
            <div className="mx-auto max-w-6xl px-4 py-16">
              <h2 className="text-center text-3xl font-bold text-brand-blue">
                Find Your Home&apos;s Value by City
              </h2>
              <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {cityCards.map(({ location, stats }) => (
                  <Link
                    key={location.id}
                    href={`/sell/${location.slug}`}
                    className="group rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <h3 className="text-xl font-bold text-brand-blue group-hover:underline">
                      {shortCityName(location.name)}
                    </h3>
                    {stats?.avgSalePrice != null ? (
                      <p className="mt-2 text-sm text-slate-600">
                        Avg. sale price:{' '}
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(stats.avgSalePrice)}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">Get your free valuation</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/* Featured testimonials */}
        {testimonials.length >= 2 ? (
          <section className="bg-white">
            <div className="mx-auto max-w-6xl px-4 py-16">
              <h2 className="text-center text-3xl font-bold text-brand-blue">
                What Michigan Homeowners Are Saying
              </h2>
              <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
                {testimonials.map((t) => (
                  <figure
                    key={t.id}
                    className="flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <blockquote className="flex-1 text-slate-700">
                      <p>&ldquo;{t.quote}&rdquo;</p>
                    </blockquote>
                    {t.saleDetails ? (
                      <div className="mt-4">
                        <Badge>{t.saleDetails}</Badge>
                      </div>
                    ) : null}
                    <figcaption className="mt-4 border-t border-slate-100 pt-4">
                      <p className="font-semibold text-brand-blue">{t.clientName}</p>
                      {t.neighborhood ? (
                        <p className="text-sm text-slate-500">{t.neighborhood}</p>
                      ) : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
