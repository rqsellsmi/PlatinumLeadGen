import { siteUrl } from '@/lib/siteUrl';
import type { Metadata } from 'next';
import SellerHomepage from '@/components/home/SellerHomepage';

// Render at request time so the page always reflects the live database.
export const dynamic = 'force-dynamic';

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'Sell Your Michigan Home | RE/MAX Platinum — Local Experts',
  description:
    'RE/MAX Platinum helps Michigan homeowners sell faster and for more money. Get a free, instant home valuation and connect with a local expert who knows your market.',
  alternates: { canonical: `${SITE_URL}/sell/home-value` },
};

export default function SellHomeValuePage() {
  return <SellerHomepage />;
}
