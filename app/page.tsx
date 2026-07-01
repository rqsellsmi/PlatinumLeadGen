import type { Metadata } from 'next';
import Image from 'next/image';
import {
  getHomepageAggregateStats,
  getFeaturedRecentSales,
  getCityTiles,
  getGuidesForPage,
  getFeaturedTestimonials,
} from '@/lib/queries';
import { formatNumber } from '@/lib/utils';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import HeroValuation from '@/components/HeroValuation';
import HomeMetricsBar from '@/components/home/HomeMetricsBar';
import HomeRecentSales from '@/components/home/HomeRecentSales';
import ExploreMarket from '@/components/home/ExploreMarket';
import GuideDownloadBlock from '@/components/home/GuideDownloadBlock';
import ValueCta from '@/components/home/ValueCta';

// Render at request time so the page always reflects the live database (the
// admin pages are already dynamic). ISR can be re-enabled after launch.
export const dynamic = 'force-dynamic';

const SITE_URL = process.env.SITE_URL ?? 'https://remax-platinumonline.com';

export const metadata: Metadata = {
  title: 'Sell Your Michigan Home | RE/MAX Platinum — Local Experts',
  description:
    'RE/MAX Platinum helps Michigan homeowners sell faster and for more money. Get a free, instant home valuation and connect with a local expert who knows your market.',
  alternates: { canonical: SITE_URL },
};

export default async function HomePage() {
  const [stats, recentSales, cityTiles, guides, testimonials] = await Promise.all([
    getHomepageAggregateStats(),
    getFeaturedRecentSales(6),
    getCityTiles(),
    getGuidesForPage('home'),
    getFeaturedTestimonials(3),
  ]);
  const guide = guides[0] ?? null;

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
                {stats.homesSold
                  ? `RE/MAX Platinum has helped ${formatNumber(stats.homesSold)} families sell across South East Michigan. `
                  : 'RE/MAX Platinum helps families across South East Michigan sell for more. '}
                Find out what your home is worth today — free, and with no obligation.
              </p>
              <div className="mt-8">
                <HeroValuation buttonLabel="What's My Home Worth? →" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold text-white">
                {stats.avgRating != null ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-platinum-red" aria-hidden>
                      ★
                    </span>
                    {stats.avgRating.toFixed(1)}
                    {stats.reviewCount ? ` · ${formatNumber(stats.reviewCount)}+ reviews` : ''}
                  </span>
                ) : null}
                <span className="text-white/90">Free · No obligation · Instant estimate</span>
              </div>
            </div>
          </div>
        </section>

        {/* Aggregate community metrics */}
        <HomeMetricsBar stats={stats} />

        {/* Recent sales across all communities */}
        <HomeRecentSales sales={recentSales} />

        {/* Explore Your Market — city cards linking to community pages */}
        <ExploreMarket cities={cityTiles} />

        {/* Seller guide download (admin-managed; shown when assigned to "home") */}
        {guide ? <GuideDownloadBlock guide={guide} /> : null}

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

        {/* Closing CTA band */}
        <ValueCta />
      </main>
      <SiteFooter />
    </>
  );
}
