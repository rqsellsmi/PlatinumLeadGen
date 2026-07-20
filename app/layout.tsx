import { siteUrl } from '@/lib/siteUrl';
import type { Metadata } from 'next';
import { fontVariables } from '@/lib/fonts';
import Analytics from '@/components/Analytics';
import AttributionCapture from '@/components/AttributionCapture';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'RE/MAX Platinum — Michigan Home Values & Free Home Valuation',
    template: '%s | RE/MAX Platinum',
  },
  description:
    'RE/MAX Platinum helps Michigan homeowners sell faster and for more money. Get your free home valuation today.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="font-sans text-ink antialiased">
        <Analytics />
        <AttributionCapture />
        {children}
      </body>
    </html>
  );
}
