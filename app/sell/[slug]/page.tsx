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
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import HeroSection from '@/components/city/HeroSection';
import SocialProofBar from '@/components/city/SocialProofBar';
import MarketStatsBar from '@/components/city/MarketStatsBar';
import ValuationForm from '@/components/city/ValuationForm';
import RecentSales from '@/components/city/RecentSales';
import HowItWorks from '@/components/city/HowItWorks';
import SellerGuideSection from '@/components/city/SellerGuideSection';
import Testimonials from '@/components/city/Testimonials';
import FaqSection from '@/components/city/FaqSection';
import NeighborhoodLinks from '@/components/city/NeighborhoodLinks';
import TrackingScripts from '@/components/city/TrackingScripts';
import StickyCtaBar from '@/components/cro/StickyCtaBar';
import ExitIntentOverlay from '@/components/cro/ExitIntentOverlay';

export const revalidate = 3600;

const SITE_URL = process.env.SITE_URL ?? 'https://remax-platinumonline.com';

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

  const { location, stats, recentSales, testimonials, neighborhoodLinks, trackingScripts } = data;
  const cityName = shortCityName(location.name);

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
        <HeroSection
          headline={headline}
          subheadline={subheadline}
          cityName={cityName}
          eyebrow={location.name}
          rating={location.googleReviewRating}
          reviewCount={location.googleReviewCount}
          homesSold={location.socialProofCount ?? stats?.homesSold ?? null}
        />
        <SocialProofBar
          cityName={cityName}
          socialProofCount={location.socialProofCount ?? 0}
          googleReviewRating={location.googleReviewRating}
          googleReviewCount={location.googleReviewCount}
          topTestimonial={testimonials.find((t) => t.isActive) ?? null}
        />
        <MarketStatsBar stats={stats} cityName={cityName} homesSold={stats?.homesSold ?? 0} />
        <ValuationForm locationSlug={location.slug} cityName={cityName} pageVariant="seo" />
        <RecentSales sales={recentSales} cityName={cityName} />
        <HowItWorks />
        {location.guideUrl ? (
          <SellerGuideSection locationSlug={location.slug} guideUrl={location.guideUrl} />
        ) : null}
        <Testimonials testimonials={testimonials} cityName={cityName} />
        <FaqSection faq={faq} cityName={cityName} />
        <NeighborhoodLinks links={neighborhoodLinks} cityName={cityName} />
        <TrackingScripts scripts={trackingScripts} />
      </main>
      <SiteFooter />
      <StickyCtaBar />
      <ExitIntentOverlay />
    </>
  );
}
