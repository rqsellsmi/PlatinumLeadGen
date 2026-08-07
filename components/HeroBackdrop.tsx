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
 * Instead the index is derived from `seed` during render: stable for a given page,
 * different across pages, decided before a single byte is fetched. `priority` now
 * preloads the image that is actually shown. The cost is that a given city always
 * shows the same photo rather than varying per reload — worth it, and reload
 * variety was never visible to a first-time visitor anyway.
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

export default function HeroBackdrop({
  images,
  alt = '',
  seed = '',
}: {
  images: string[];
  alt?: string;
  /** Picks which image this page shows. Use something page-stable, e.g. the slug. */
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
