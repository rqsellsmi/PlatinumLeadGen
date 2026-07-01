import type { Config } from 'tailwindcss';

/**
 * RE/MAX Platinum design system (Spec Section 15).
 * Colors are defined here as theme tokens so components reference
 * e.g. `bg-platinum-red` rather than hardcoding hex values.
 *
 * NOTE: we deliberately do NOT override Tailwind's built-in `slate` scale —
 * lots of existing components use slate-200/500/700 etc. Muted brand greys
 * live under the `mute` key instead.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        platinum: {
          red: '#FF1200', // primary action color
          redHover: '#660000', // red hover state
          blue: '#0043FF', // secondary accent
        },
        charcoal: {
          DEFAULT: '#232323', // sidebar bg, headings on white
          light: '#2D2D33', // card/panel bg inside dark sidebar
        },
        ink: '#141418', // body text on public pages
        mute: {
          DEFAULT: '#54545C', // secondary/muted text
          light: '#74747F', // tertiary text
          lighter: '#A0A0AA', // disabled, placeholder, sidebar secondary
        },
        line: {
          DEFAULT: '#E2E2E6', // borders
          hair: '#F1F1F1', // row dividers, progress tracks
        },
        offwhite: '#F7F7F8', // admin/portal page bg
        cream: '#F7F5EE', // public section bg + estimate callout
        success: { DEFAULT: '#1F7A4A', bg: '#E4F2EA' },
        warning: { DEFAULT: '#C97A13', bg: '#FBF0DC' },
        danger: { DEFAULT: '#FF1200', bg: '#FFE9E6' },
        brandpurple: { DEFAULT: '#7A3FB5', bg: '#F0E8F9' },
        // Legacy aliases so any not-yet-restyled component still compiles.
        brand: { blue: '#0043FF', red: '#FF1200', light: '#F7F5EE' },
      },
      fontFamily: {
        sans: ['var(--font-montserrat)', 'system-ui', 'sans-serif'],
        display: ['var(--font-barlow)', 'var(--font-montserrat)', 'sans-serif'],
        serif: ['var(--font-playfair)', 'Georgia', 'serif'],
      },
      borderRadius: {
        pill: '999px',
        card: '13px',
      },
      keyframes: {
        slideOver: {
          from: { transform: 'translateX(24px)', opacity: '0' },
          to: { transform: 'none', opacity: '1' },
        },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        countUp: { from: { opacity: '0.4' }, to: { opacity: '1' } },
      },
      animation: {
        slideOver: 'slideOver 0.22s ease-out',
        fadeIn: 'fadeIn 0.18s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
