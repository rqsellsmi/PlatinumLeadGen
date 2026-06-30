import type { Metadata } from 'next';
import { inter } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://remax-platinumonline.com'),
  title: {
    default: 'RE/MAX Platinum — Michigan Home Values & Free Home Valuation',
    template: '%s | RE/MAX Platinum',
  },
  description:
    'RE/MAX Platinum helps Michigan homeowners sell faster and for more money. Get your free home valuation today.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
