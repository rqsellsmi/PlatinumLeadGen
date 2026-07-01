/**
 * Seed script (Section 3.4).
 * Inserts the four launch locations with SEO copy stubs + default FAQ.
 * Also seeds a single notificationSettings row and an empty homePageMetrics row.
 *
 * Run once after the initial migration:  npm run seed
 *
 * marketStats, recentSales, and testimonials are intentionally left empty —
 * the admin populates those from the dashboard after launch.
 */
import 'dotenv/config';
import { db } from '../lib/db';
import {
  locations,
  notificationSettings,
  homePageMetrics,
} from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { resolveDatabaseUrl } from '../lib/dbUrl';

// Seeding only needs a connection string — skip the full app env validation so
// you don't have to set MS Graph / RentCast / NextAuth vars just to seed.
// (validateEnv() runs lazily on the first query, so setting this here works.)
process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION ?? '1';
if (!resolveDatabaseUrl()) {
  console.error(
    '\n✗ DATABASE_URL is not set.\n' +
      '  Add your Neon connection string to a .env file in the project root:\n' +
      '    DATABASE_URL="postgresql://user:pass@host.neon.tech/neondb?sslmode=require"\n' +
      '  Then:  npm run db:migrate   (creates the tables)\n' +
      '  Then:  npm run seed         (this script)\n',
  );
  process.exit(1);
}

interface CitySeed {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

const CITIES: CitySeed[] = [
  { slug: 'brighton-mi', name: 'Brighton, Michigan', latitude: 42.5295, longitude: -83.7799 },
  { slug: 'ann-arbor-mi', name: 'Ann Arbor, Michigan', latitude: 42.2808, longitude: -83.743 },
  { slug: 'fenton-mi', name: 'Fenton, Michigan', latitude: 42.7959, longitude: -83.7085 },
  { slug: 'grand-blanc-mi', name: 'Grand Blanc, Michigan', latitude: 42.9267, longitude: -83.6305 },
];

/** "Brighton, Michigan" -> "Brighton" */
function cityShortName(name: string): string {
  return name.split(',')[0].trim();
}

function buildSeo(name: string) {
  const city = cityShortName(name);
  const metaTitle = `${city} MI Home Values & Free Home Valuation | RE/MAX Platinum`;
  const metaDescription = `Find out what your ${city}, MI home is worth. Free home valuation from RE/MAX Platinum — local experts. See current market stats and recent sales.`;
  const heroHeadline = `What Is My Home Worth in ${city}, MI?`;
  const heroSubheadline = `Get a free, instant home valuation based on recent ${city} sales — then connect with a local RE/MAX Platinum expert to maximize your sale price.`;

  // Default FAQ for every city (Section 4.5). Stat placeholders are filled at
  // render time when marketStats exist; stored copy keeps a sensible fallback.
  const faq = [
    {
      question: `How much is my home worth in ${city}, MI?`,
      answer: `Home values in ${city}, MI vary by neighborhood, condition, and current market demand. Enter your address above for a free instant estimate based on recent ${city} sales, then connect with a local RE/MAX Platinum expert for a precise valuation.`,
    },
    {
      question: `How long does it take to sell a home in ${city}?`,
      answer: `Average time-to-sell in ${city} depends on pricing and market conditions. Our local agents price strategically to sell quickly while maximizing your return.`,
    },
    {
      question: `What percentage of asking price do homes sell for in ${city}?`,
      answer: `Well-priced ${city} homes routinely sell at or above asking. We track current sale-to-list ratios so your home is priced to compete.`,
    },
    {
      question: `Do I need to make repairs before selling?`,
      answer: `Not always. RE/MAX Platinum advises on the highest-ROI improvements — and which to skip — so you don't overspend before listing. Many homes sell as-is.`,
    },
    {
      question: `How do I get started?`,
      answer: `Enter your address in the valuation tool above to get your free estimate. A local RE/MAX Platinum expert will follow up to review your personalized market report.`,
    },
  ];

  return {
    metaTitle,
    metaDescription,
    heroHeadline,
    heroSubheadline,
    faqJson: JSON.stringify(faq),
  };
}

async function main() {
  console.log('Seeding locations…');
  for (const c of CITIES) {
    const seo = buildSeo(c.name);
    const existing = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, c.slug));

    if (existing.length > 0) {
      console.log(`  - ${c.slug} already exists, updating SEO stubs`);
      await db
        .update(locations)
        .set({
          name: c.name,
          state: 'MI',
          latitude: c.latitude,
          longitude: c.longitude,
          isActive: true,
          ...seo,
          updatedAt: new Date(),
        })
        .where(eq(locations.slug, c.slug));
    } else {
      console.log(`  - inserting ${c.slug}`);
      await db.insert(locations).values({
        slug: c.slug,
        name: c.name,
        state: 'MI',
        latitude: c.latitude,
        longitude: c.longitude,
        isActive: true,
        ...seo,
      });
    }
  }

  // Single-row config tables.
  const settings = await db.select({ id: notificationSettings.id }).from(notificationSettings);
  if (settings.length === 0) {
    console.log('Seeding notificationSettings…');
    await db.insert(notificationSettings).values({
      notificationEmail: process.env.EMAIL_ADMIN_EMAIL ?? null,
      offerWindowStartHour: 7,
      offerWindowEndHour: 20,
      proximityRadiusMiles: 20,
      queuePointer: 0,
    });
  }

  const metrics = await db.select({ id: homePageMetrics.id }).from(homePageMetrics);
  if (metrics.length === 0) {
    console.log('Seeding homePageMetrics…');
    await db.insert(homePageMetrics).values({
      totalHomesSold: null,
      avgDaysToSell: null,
      avgSalePrice: null,
    });
  }

  console.log('Seed complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
