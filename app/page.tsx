import { siteUrl } from '@/lib/siteUrl';
import type { Metadata } from 'next';
import { getHomepageAggregateStats, getHomePageMetrics } from '@/lib/queries';
import { getRecentActiveListings, getBuyerCityTiles } from '@/lib/buyerHome';
import { getPhotosForListings } from '@/lib/idx';
import { formatNumber } from '@/lib/utils';
import { getHeroImages } from '@/lib/heroImages';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import HeroBackdrop from '@/components/HeroBackdrop';
import HomeSearchHero from '@/components/home/HomeSearchHero';
import HomeActiveListings from '@/components/home/HomeActiveListings';
import BuyerCityTiles from '@/components/home/BuyerCityTiles';
import MarketStatsBar from '@/components/city/MarketStatsBar';
import ValueCta from '@/components/home/ValueCta';

export const dynamic = 'force-dynamic';

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'Homes for Sale in Southeast Michigan | RE/MAX Platinum',
  description:
    'Search homes for sale across Southeast Michigan with RE/MAX Platinum. Browse the latest MLS listings, filter by price, beds and location, and connect with a local expert — or find out what your own home is worth.',
  alternates: { canonical: SITE_URL },
};

export default async function HomePage() {
  const [stats, homeMetrics, activeListings, cityTiles, heroImages] = await Promise.all([
    getHomepageAggregateStats(),
    getHomePageMetrics(),
    getRecentActiveListings(9),
    getBuyerCityTiles(12),
    getHeroImages(),
  ]);
  const photos = activeListings.length
    ? await getPhotosForListings(activeListings.map((l) => l.listingKey))
    : new Map<string, string[]>();

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero — buyer-first search */}
        <section className="relative isolate flex min-h-[520px] items-center px-5 py-20 sm:px-8 lg:px-12">
          <HeroBackdrop images={heroImages} alt="Michigan homes" />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-r from-[rgba(20,20,24,0.8)] via-[rgba(20,20,24,0.55)] to-[rgba(20,20,24,0.3)]"
          />
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-[720px]">
              <h1 className="text-5xl font-black leading-[1.0] tracking-tight text-white sm:text-6xl">
                Find your next home in Michigan.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/90">
                Search the latest listings across Southeast Michigan and tour with a local RE/MAX
                Platinum expert who knows the market.
              </p>
              <div className="mt-8">
                <HomeSearchHero />
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
                <span className="text-white/90">Local experts · Updated from the MLS</span>
              </div>
            </div>
          </div>
        </section>

        {/* Newest active listings */}
        <HomeActiveListings listings={activeListings} photos={photos} />

        {/* Browse by city */}
        <BuyerCityTiles tiles={cityTiles} />

        {/* Brokerage market stats */}
        <MarketStatsBar
          avgSalePrice={homeMetrics?.avgSalePrice ?? null}
          daysToSell={homeMetrics?.avgDaysToSell ?? null}
          homesSold={homeMetrics?.homesSold ?? null}
          percentAboveList={homeMetrics?.pctAboveListPrice ?? null}
          subtext={
            homeMetrics?.homesSold
              ? `Based on ${formatNumber(homeMetrics.homesSold)} homes sold across Southeast Michigan over the last 12 months.`
              : null
          }
        />

        {/* Seller capture — thinking of selling? */}
        <ValueCta />
      </main>
      <SiteFooter />
    </>
  );
}
