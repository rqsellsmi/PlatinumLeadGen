import { Inter } from 'next/font/google';

// Loaded via next/font so fonts don't block render (Section 2.8 Core Web Vitals).
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
