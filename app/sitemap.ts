import type { MetadataRoute } from 'next';
import { getActiveLocations } from '@/lib/queries';

// Generated at request time — it reads the DB (locations), and the no-store Neon
// driver would throw "Dynamic server usage" if this were prerendered at build.
export const dynamic = 'force-dynamic';

const SITE_URL = process.env.SITE_URL ?? 'https://remax-platinumonline.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locations = await getActiveLocations();

  const cityEntries: MetadataRoute.Sitemap = locations.map((location) => ({
    url: `${SITE_URL}/sell/${location.slug}`,
    lastModified: location.updatedAt ?? new Date(),
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/sell`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    ...cityEntries,
  ];
}
