import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getActiveLocations,
  getMarketStats,
  getHomePageMetrics,
  getFeaturedTestimonials,
} from '@/lib/queries';
import Image from 'next/image';
import { formatCurrency, formatNumber } from '@/lib/utils';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import HeroAddressForm from '@/components/city/HeroAddressForm';
import ValuationForm from '@/components/city/ValuationForm';

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
        <section className="relative isolate flex min-h-[560px] items-center px-5 py-20 sm:px-8 lg:px-12">
          <Image
            src="/assets/hero-home.jpg"
            alt="Michigan homes"
            fill
            priority
            sizes="100vw"
            className="-z-10 object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-r from-[rgba(20,20,24,0.78)] via-[rgba(20,20,24,0.55)] to-[rgba(20,20,24,0.3)]"
          />
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-[680px]">
              <h1 className="text-5xl font-black leading-[1.0] tracking-tight text-white sm:text-7xl">
                Your home is here. So are we.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/90 sm:text-xl">
                RE/MAX Platinum has helped over 1,100 families sell across South East Michigan. Find
                out what your home is worth today — free, and with no obligation.
              </p>
              <div className="mt-8">
                <HeroAddressForm buttonLabel="What's My Home Worth? →" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold text-white">
                <span className="flex items-center gap-1.5">
                  <span className="text-platinum-red" aria-hidden>
                    ★
                  </span>
                  4.9 · 300+ reviews
                </span>
                <span className="text-white/90">Free · No obligation · Instant estimate</span>
              </div>
            </div>
          </div>
        </section>

        {/* Valuation form — general (routes by property proximity, no city required) */}
        <ValuationForm locationSlug="" cityName="Michigan" pageVariant="seo" />

        {/* Overall stats */}
        {metrics ? (
          <section className="bg-charcoal">
            <div className="mx-auto max-w-6xl px-4 py-14">
              <dl className="grid grid-cols-1 gap-8 sm:grid-cols-3">
                {[
                  { value: formatNumber(metrics.totalHomesSold), label: 'Homes Sold' },
                  { value: formatNumber(metrics.avgDaysToSell), label: 'Avg. Days to Sell' },
                  { value: formatCurrency(metrics.avgSalePrice), label: 'Avg. Sale Price' },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <dd className="font-numeric text-5xl font-bold leading-none text-white sm:text-6xl">
                      {s.value}
                    </dd>
                    <dt className="mt-2 text-sm font-semibold text-mute-lighter">{s.label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        ) : null}

        {/* City cards */}
        {cityCards.length ? (
          <section className="bg-cream">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
              <h2 className="text-center text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
                Find Your Home&apos;s Value by City
              </h2>
              <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {cityCards.map(({ location, stats }) => (
                  <Link
                    key={location.id}
                    href={`/sell/${location.slug}`}
                    className="group rounded-card border border-line bg-white p-6 transition-shadow hover:shadow-[0_12px_32px_rgba(20,20,24,0.12)]"
                  >
                    <h3 className="text-xl font-bold text-charcoal group-hover:text-platinum-red">
                      {shortCityName(location.name)}
                    </h3>
                    {stats?.avgSalePrice != null ? (
                      <p className="mt-2 text-sm text-mute">
                        Avg. sale price:{' '}
                        <span className="font-numeric font-bold text-charcoal">
                          {formatCurrency(stats.avgSalePrice)}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-mute-light">Get your free valuation →</p>
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
            <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
              <h2 className="text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
                What Michigan Homeowners Are Saying
              </h2>
              <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
                {testimonials.map((t) => (
                  <figure key={t.id} className="flex flex-col rounded-xl bg-cream p-9">
                    <div className="mb-4 flex gap-0.5 text-platinum-red" aria-hidden>
                      {'★★★★★'.split('').map((s, i) => (
                        <span key={i}>{s}</span>
                      ))}
                    </div>
                    <blockquote className="flex-1">
                      <p className="font-serif text-xl leading-relaxed text-charcoal">
                        &ldquo;{t.quote}&rdquo;
                      </p>
                    </blockquote>
                    {t.saleDetails ? (
                      <div className="mt-5">
                        <span className="inline-block rounded-pill border border-line bg-white px-3 py-1.5 text-xs font-bold text-success">
                          {t.saleDetails}
                        </span>
                      </div>
                    ) : null}
                    <figcaption className="mt-4">
                      <p className="font-bold text-charcoal">{t.clientName}</p>
                      {t.neighborhood ? (
                        <p className="text-sm text-mute-light">{t.neighborhood}</p>
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
