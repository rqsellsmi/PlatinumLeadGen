import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ThankYouClient from './ThankYouClient';
import {
  getLocationBySlug,
  getMarketStats,
  getCityRecentSales,
  getFeaturedRecentSales,
  locationMatchCities,
  type HomeRecentSale,
} from '@/lib/queries';
import type { MarketStat } from '@/drizzle/schema';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Home Valuation Report | RE/MAX Platinum',
  description: 'Your personalized home valuation report from RE/MAX Platinum.',
  robots: { index: false, follow: false },
};

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: { city?: string };
}) {
  const citySlug = (searchParams.city ?? '').trim();

  let cityName = '';
  let snapshot: MarketStat | null = null;
  let comps: HomeRecentSale[] = [];

  if (citySlug) {
    const loc = await getLocationBySlug(citySlug);
    if (loc) {
      cityName = loc.name.split(',')[0].trim();
      [snapshot, comps] = await Promise.all([
        getMarketStats(loc.id),
        getCityRecentSales(locationMatchCities(loc), 6),
      ]);
    }
  }
  if (comps.length === 0) comps = await getFeaturedRecentSales(6);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <Suspense fallback={null}>
          <ThankYouClient comps={comps} snapshot={snapshot} cityName={cityName} />
        </Suspense>
        <div className="mt-10 text-center">
          <Link href="/" className="text-sm font-semibold text-platinum-blue hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
