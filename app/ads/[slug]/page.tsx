import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices } from '@/drizzle/schema';
import { getActiveLocations, getLocationBySlug, getCityPageData } from '@/lib/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import AdsHeader from '@/components/ads/AdsHeader';
import AdsHero from '@/components/ads/AdsHero';
import AdsTrustBar from '@/components/ads/AdsTrustBar';
import SocialProofBar from '@/components/city/SocialProofBar';
import StickyCtaBar from '@/components/cro/StickyCtaBar';
import ExitIntentOverlay from '@/components/cro/ExitIntentOverlay';
import TrackingScripts from '@/components/city/TrackingScripts';

// Render at request time. ISR (revalidate) statically prerenders these pages,
// which throws "Dynamic server usage: no-store fetch" when the market-report
// narrative (Anthropic) — and the no-store Neon DB reads — run during build.
// Force-dynamic renders per request, so those calls are valid and the page
// always reflects live data.
export const dynamic = 'force-dynamic';

const DEFAULT_PHONE = '(810) 224-7900';

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
  const cityName = location ? shortCityName(location.name) : 'Michigan';
  return {
    // CRITICAL: PPC pages must never be indexed (Section 20.4 / 2.1).
    robots: { index: false, follow: false },
    title: `Free Home Valuation in ${cityName} | RE/MAX Platinum`,
  };
}

async function officePhone(): Promise<string> {
  try {
    const rows = await db
      .select({ phone: offices.phone })
      .from(offices)
      .where(isNotNull(offices.phone))
      .limit(1);
    return rows[0]?.phone ?? DEFAULT_PHONE;
  } catch {
    return DEFAULT_PHONE;
  }
}

const HOW_IT_WORKS = [
  { icon: '🏠', text: 'Enter your address' },
  { icon: '📈', text: 'See your instant estimate' },
  { icon: '🤝', text: 'A local expert reviews it' },
];

export default async function AdsPage({ params }: { params: { slug: string } }) {
  const data = await getCityPageData(params.slug);
  if (!data) notFound();

  const { location, stats, testimonials, trackingScripts } = data;
  const cityName = shortCityName(location.name);
  const phone = await officePhone();
  const headline = location.heroHeadline ?? `What's Your ${cityName} Home Worth?`;

  return (
    <>
      <AdsHeader phone={phone} />
      <main>
        <AdsHero headline={headline} cityName={cityName} locationSlug={location.slug} />

        <SocialProofBar
          cityName={cityName}
          socialProofCount={location.socialProofCount ?? 0}
          googleReviewRating={location.googleReviewRating}
          googleReviewCount={location.googleReviewCount}
          topTestimonial={testimonials.find((t) => t.isActive) ?? null}
        />

        {/* Abbreviated How It Works (Section 20.3 #4) */}
        <section className="bg-white">
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 px-4 py-10 sm:grid-cols-3">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.text} className="text-center">
                <div className="text-3xl" aria-hidden>
                  {s.icon}
                </div>
                <p className="mt-2 text-sm font-semibold text-charcoal">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Condensed market stats (Section 20.3 #5): two stats */}
        {stats ? (
          <section className="bg-cream">
            <div className="mx-auto grid max-w-3xl grid-cols-2 gap-5 px-4 py-10">
              <div className="rounded-card border border-line bg-white px-4 py-6 text-center">
                <p className="font-numeric text-3xl font-bold text-charcoal">
                  {formatCurrency(stats.avgSalePrice)}
                </p>
                <p className="mt-1 text-sm font-semibold text-mute">Avg sale price in {cityName}</p>
              </div>
              <div className="rounded-card border border-line bg-white px-4 py-6 text-center">
                <p className="font-numeric text-3xl font-bold text-charcoal">
                  {stats.daysToSell != null ? formatNumber(stats.daysToSell) : '—'}
                </p>
                <p className="mt-1 text-sm font-semibold text-mute">Avg days to sell</p>
              </div>
            </div>
          </section>
        ) : null}

        <AdsTrustBar
          googleReviewRating={location.googleReviewRating}
          googleReviewCount={location.googleReviewCount}
          homesSold={stats?.homesSold ?? null}
        />

        <TrackingScripts scripts={trackingScripts} />
      </main>

      {/* Minimal footer (Section 20.3 #9) */}
      <footer className="bg-white py-8 text-center text-xs text-mute-light">
        &copy; {new Date().getFullYear()} RE/MAX Platinum.{' '}
        <a href="/privacy" className="underline hover:text-charcoal">
          Privacy Policy
        </a>
        .
      </footer>

      <StickyCtaBar />
      <ExitIntentOverlay />
    </>
  );
}
