import { siteUrl } from '@/lib/siteUrl';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getActiveLocations,
  getLocationBySlug,
  getCityPageData,
} from '@/lib/queries';
import {
  parseFaqJson,
  fillFaqStats,
  generateCityStructuredData,
} from '@/lib/seo';
import { formatNumber } from '@/lib/utils';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import HeroSection from '@/components/city/HeroSection';
import SocialProofBar from '@/components/city/SocialProofBar';
import MarketStatsBar from '@/components/city/MarketStatsBar';
import RecentSales from '@/components/city/RecentSales';
import MarketReport from '@/components/idx/MarketReport';
import IdxCompliance from '@/components/idx/IdxCompliance';
import HowItWorks from '@/components/city/HowItWorks';
import SellerGuideSection from '@/components/city/SellerGuideSection';
import Testimonials from '@/components/city/Testimonials';
import GoogleReviews from '@/components/city/GoogleReviews';
import FaqSection from '@/components/city/FaqSection';
import NeighborhoodLinks from '@/components/city/NeighborhoodLinks';
import TrackingScripts from '@/components/city/TrackingScripts';
import StickyCtaBar from '@/components/cro/StickyCtaBar';
import ExitIntentOverlay from '@/components/cro/ExitIntentOverlay';

// ISR, not request-time rendering. This page was `force-dynamic` so that new or
// edited cities appeared immediately; `dynamicParams` keeps that property (a city
// added after the last build renders on first request, then serves from cache) and
// the admin save actions already call `revalidatePath('/sell/[slug]', 'page')`, so
// edits still publish instantly. See docs/city-page-isr.md.
//
// Why it changed: rendering per request made a COLD hit cost ~12.7s TTFB (measured)
// against a ~0.47s static floor on this site, because the render pays a Vercel cold
// start, a Neon resume from auto-suspend, three sequential DB waves (getLocationBySlug
// → the Promise.all → getMarketNarrative) and, on a stats change, a live Anthropic
// call that aborts at 9s. Under ISR that whole cost moves to a background refresh
// where no visitor is waiting on it.
//
// The hourly window is the safety net for the one writer that CANNOT call
// revalidatePath: the IDX sync runs as a standalone script on a GitHub runner, a
// different process from this app, so it POSTs /api/revalidate instead.
export const revalidate = 3600;
export const dynamicParams = true;

const SITE_URL = siteUrl();

/** Short city name, e.g. "Brighton, MI" -> "Brighton". */
function shortCityName(name: string): string {
  return name.split(',')[0].trim();
}

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const locations = await getActiveLocations();
  return locations.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const location = await getLocationBySlug(params.slug);
  if (!location) return {};

  const url = `${SITE_URL}/sell/${params.slug}`;
  const title = location.metaTitle ?? `Sell Your Home in ${location.name}`;
  const description =
    location.metaDescription ??
    `Find out what your ${shortCityName(location.name)} home is worth with RE/MAX Platinum.`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

export default async function CityPage({ params }: { params: { slug: string } }) {
  const data = await getCityPageData(params.slug);
  if (!data) notFound();

  const {
    location,
    stats,
    recentSales,
    testimonials,
    neighborhoodLinks,
    trackingScripts,
    googleReviews,
    reviewRating,
    reviewCount,
    idxMarketReport,
    idxMarketNarrative,
  } = data;
  const cityName = shortCityName(location.name);

  const hasMarketReport =
    idxMarketReport != null &&
    (idxMarketReport.medianSalePrice != null ||
      idxMarketReport.homesSold90d > 0 ||
      idxMarketReport.activeListings > 0 ||
      idxMarketReport.trailing.some((t) => t.median != null));

  const faq = fillFaqStats(parseFaqJson(location.faqJson), stats);

  const structuredData = generateCityStructuredData({
    cityName,
    state: location.state,
    siteUrl: SITE_URL,
    faq,
  });

  const headline = location.heroHeadline ?? `What's Your ${cityName} Home Worth?`;
  const subheadline =
    location.heroSubheadline ??
    `Get a free, instant home valuation from ${cityName}'s trusted RE/MAX Platinum experts.`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SiteHeader />
      <main>
        {/* `homesSold` on both bars below is VERIFIED transactions (market_stats
            / IDX office deals). It used to read location.socialProofCount — a
            count of FORM SUBMISSIONS rendered as "N+ homes sold", which is how
            this page came to claim "1+ homes sold" directly above its own
            market section reporting 89 real sales (D2). */}
        <HeroSection
          headline={headline}
          subheadline={subheadline}
          cityName={cityName}
          locationSlug={location.slug}
          pageVariant="seo"
          eyebrow={location.name}
          rating={reviewRating}
          reviewCount={reviewCount}
          homesSold={stats?.homesSold ?? null}
        />
        <SocialProofBar
          cityName={cityName}
          homesSold={stats?.homesSold ?? null}
          googleReviewRating={reviewRating}
          googleReviewCount={reviewCount}
          topTestimonial={testimonials.find((t) => t.isActive) ?? null}
        />
        <MarketStatsBar
          avgSalePrice={stats?.avgSalePrice ?? null}
          daysToSell={stats?.daysToSell ?? null}
          homesSold={stats?.homesSold ?? null}
          percentAboveList={stats?.percentAboveList ?? null}
          subtext={
            stats?.homesSold
              ? `Based on ${formatNumber(stats.homesSold)} homes sold in ${cityName} over the last 12 months.`
              : null
          }
        />
        <RecentSales sales={recentSales} cityName={cityName} />
        {hasMarketReport ? (
          <section className="bg-cream">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
              <MarketReport report={idxMarketReport} cityName={cityName} narrative={idxMarketNarrative} />
              <IdxCompliance variant="summary" firstOnPage />
            </div>
          </section>
        ) : null}
        <HowItWorks />
        {location.guideUrl ? (
          <SellerGuideSection locationSlug={location.slug} guideUrl={location.guideUrl} />
        ) : null}
        <Testimonials testimonials={testimonials} cityName={cityName} />
        <GoogleReviews
          reviews={googleReviews}
          cityName={cityName}
          rating={reviewRating}
          reviewCount={reviewCount}
        />
        <FaqSection faq={faq} cityName={cityName} />
        <NeighborhoodLinks links={neighborhoodLinks} cityName={cityName} />
        <TrackingScripts scripts={trackingScripts} />
      </main>
      <SiteFooter
        locationId={location.id}
        latitude={location.latitude}
        longitude={location.longitude}
      />
      <StickyCtaBar />
      <ExitIntentOverlay />
    </>
  );
}
