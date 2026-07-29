import { siteUrl } from '@/lib/siteUrl';
import type { MetadataRoute } from 'next';

const SITE_URL = siteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // /ads is retired (D1) but stays listed: the 301 to /sell must not be
      // followed and re-indexed under the old path while any ad or backlink
      // still points there.
      disallow: ['/admin', '/admin/', '/agent/', '/api/', '/ads', '/ads/', '/thank-you'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
