import { Montserrat, Barlow_Condensed, Playfair_Display } from 'next/font/google';

/**
 * Brand typography (Spec Section 15.2). Loaded via next/font so fonts don't
 * block render (Core Web Vitals, Section 2.7).
 *   Montserrat       — body / UI
 *   Barlow Condensed — large numbers (stats, prices, KPIs)
 *   Playfair Display — sparing serif accent on public hero headlines only
 */
export const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-montserrat',
});

export const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-barlow',
});

export const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair',
});

/** Combined font CSS variable classes for the root <html>. */
export const fontVariables = `${montserrat.variable} ${barlowCondensed.variable} ${playfair.variable}`;
