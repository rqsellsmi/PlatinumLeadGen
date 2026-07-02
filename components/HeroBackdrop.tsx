'use client';

import * as React from 'react';
import Image from 'next/image';

/**
 * Full-bleed hero background that cross-fades through several images. Sits at
 * -z-10 so the section's gradient (also -z-10, rendered after it) and content
 * paint on top — a drop-in replacement for the single hero <Image>. With one
 * image it simply renders that image (no rotation).
 */
export default function HeroBackdrop({
  images,
  alt = '',
  intervalMs = 6000,
}: {
  images: string[];
  alt?: string;
  intervalMs?: number;
}) {
  const list = images.length ? images : ['/assets/hero-home.jpg'];
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    if (list.length < 2) return;
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % list.length),
      intervalMs,
    );
    return () => window.clearInterval(t);
  }, [list.length, intervalMs]);

  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      {list.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt={i === 0 ? alt : ''}
          fill
          priority={i === 0}
          sizes="100vw"
          className={`object-cover transition-opacity duration-1000 ${
            i === idx ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
}
