/**
 * Hero background images for the homepage and city pages. The hero rotates
 * through this list (see components/HeroBackdrop.tsx).
 *
 * To add more: drop the file in /public/assets and add its path here, e.g.
 * '/assets/hero-home-3.jpg'. You can also point at a public Vercel Blob URL
 * (https://…/hero-x.jpg) — any absolute URL works. Order = rotation order;
 * the first image is the priority LCP asset. A single entry disables rotation.
 */
export const HERO_IMAGES: string[] = [
  '/assets/hero-home.jpg',
  '/assets/hero-home-2.jpg',
];
