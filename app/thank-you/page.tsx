import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import AppointmentForm from './AppointmentForm';

export const metadata: Metadata = {
  title: 'Thank You | RE/MAX Platinum',
  description: 'Thanks for your request. A RE/MAX Platinum agent will be in touch shortly.',
  robots: { index: false, follow: false },
};

export default function ThankYouPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-20">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-blue text-3xl text-white">
            ✓
          </div>
          <h1 className="mt-6 text-3xl font-bold text-brand-blue">Thank You!</h1>
          <p className="mt-4 text-lg text-slate-600">
            We&apos;ve received your request. A local RE/MAX Platinum expert is reviewing your
            information now.
          </p>
          <p className="mt-4 rounded-md border border-slate-200 bg-brand-light px-4 py-3 text-sm text-slate-600">
            <span className="font-semibold text-brand-blue">Expected response time:</span> within 3
            hours during business hours. If you reached out after hours, you&apos;ll hear from us the
            next business morning.
          </p>
        </div>

        <div className="mt-12">
          <AppointmentForm />
        </div>

        <div className="mt-10 text-center">
          <Link href="/" className="text-sm font-medium text-brand-blue hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
