import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://remax-platinumonline.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/admin/', '/agent/', '/api/', '/ads', '/ads/', '/thank-you'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
