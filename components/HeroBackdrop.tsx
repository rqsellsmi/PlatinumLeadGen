import * as React from 'react';
import Image from 'next/image';

/**
 * Full-bleed hero background. Picks ONE image and renders only that one.
 *
 * WHY NOT RANDOM-ON-MOUNT. This used to be a client component that rendered
 * image[0] with `priority` — so the browser preloaded it as the LCP asset — and
 * then swapped to `Math.random()` picked index inside a useEffect. That made every
 * page load download TWO full-bleed photos, threw the preloaded one away, and
 * moved the LCP element after hydration so Largest Contentful Paint was measured
 * against the second download. On a hero photo that is a lot of wasted bytes on
 * every single view.
 *
 * Instead the index is derived from `seed` during render — decided before a single
 * byte is fetched, so `priority` preloads the image actually shown.
 *
 * ROTATION still happens; the caller controls how often by what it puts in the
 * seed. The ceiling is set by how often the page re-renders, not by this file:
 *   - a force-dynamic page (the homepage) renders per request, so a random seed
 *     gives a different photo on every single visit
 *   - an ISR page (city pages) renders once per revalidation and every visitor in
 *     that window is served the same cached HTML, so a time-bucketed seed rotates
 *     the photo once per window
 * Varying per-visitor on a CACHED page is the thing that is not possible without
 * client-side JS, which is what caused the double download in the first place.
 *
 * No hooks, so this is a server component: it also drops out of the client bundle.
 */

/** Stable non-crypto string hash — same seed always picks the same image. */
function seedIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % length;
}

/**
 * Seed that changes every `everyMs`, so an ISR page picks a new photo each time it
 * regenerates. Include `key` (e.g. the city slug) so different cities are not all
 * showing the same photo at the same moment.
 */
export function rotatingSeed(key: string, everyMs = 60 * 60 * 1000): string {
  return `${key}:${Math.floor(Date.now() / everyMs)}`;
}

export default function HeroBackdrop({
  images,
  alt = '',
  seed = '',
}: {
  images: string[];
  alt?: string;
  /**
   * Picks which image this render shows. Vary it to rotate: a random value on a
   * per-request page, or slug + time bucket on a cached one. See rotatingSeed().
   */
  seed?: string;
}) {
  const list = images.length ? images : ['/assets/hero-home.jpg'];
  const src = list[seedIndex(seed, list.length)];

  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      <Image src={src} alt={alt} fill priority sizes="100vw" className="object-cover" />
    </div>
  );
}
