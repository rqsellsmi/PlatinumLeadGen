import type { Metadata } from 'next';
import Link from 'next/link';
import { getActiveLocations, getMarketStats } from '@/lib/queries';
import { formatCurrency } from '@/lib/utils';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

export const revalidate = 86400;

const SITE_URL = process.env.SITE_URL ?? 'https://remax-platinumonline.com';

export const metadata: Metadata = {
  title: 'Michigan Home Values by City | RE/MAX Platinum',
  description:
    'Browse Michigan cities served by RE/MAX Platinum and get a free, instant home valuation. See average sale prices and local market data for your area.',
  alternates: { canonical: `${SITE_URL}/sell` },
};

function shortCityName(name: string): string {
  return name.split(',')[0].trim();
}

export default async function SellIndexPage() {
  const locations = await getActiveLocations();
  const withStats = await Promise.all(
    locations.map(async (location) => ({
      location,
      stats: await getMarketStats(location.id),
    })),
  );

  return (
    <>
      <SiteHeader />
      <main>
        <section className="bg-gradient-to-br from-brand-blue to-[#16304d] text-white">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center">
            <h1 className="text-3xl font-bold sm:text-4xl">Michigan Home Values by City</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-200">
              Choose your city to get a free, instant home valuation and see what homes are selling
              for in your local market. RE/MAX Platinum agents know your neighborhood.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {withStats.map(({ location, stats }) => (
              <Link
                key={location.id}
                href={`/sell/${location.slug}`}
                className="group rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <h2 className="text-xl font-bold text-brand-blue group-hover:underline">
                  {shortCityName(location.name)}
                </h2>
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
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
