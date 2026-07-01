import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ThankYouClient from './ThankYouClient';

export const metadata: Metadata = {
  title: 'Thank You | RE/MAX Platinum',
  description: 'Thanks for your request. A RE/MAX Platinum agent will be in touch shortly.',
  robots: { index: false, follow: false },
};

export default function ThankYouPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Suspense fallback={null}>
          <ThankYouClient />
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
