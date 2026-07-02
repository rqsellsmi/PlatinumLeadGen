'use client';

import * as React from 'react';
import Image from 'next/image';

/**
 * Full-bleed hero background. Picks ONE image per page load and keeps it fixed
 * while the visitor is on the page — no rotation. A different image may appear
 * on the next reload. Sits at -z-10 so the section's gradient (also -z-10,
 * rendered after it) and content paint on top.
 *
 * The image is chosen on the client after mount so it can vary per load even on
 * statically-rendered city pages; the first paint uses the first image (a good
 * priority LCP asset), then swaps once to the picked one.
 */
export default function HeroBackdrop({ images, alt = '' }: { images: string[]; alt?: string }) {
  const list = images.length ? images : ['/assets/hero-home.jpg'];
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    // One-time pick on load; no interval, so it never changes while viewing.
    if (list.length > 1) setIdx(Math.floor(Math.random() * list.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      <Image
        src={list[idx]}
        alt={alt}
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
    </div>
  );
}
