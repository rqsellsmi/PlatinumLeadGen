'use client';

import * as React from 'react';
import Image from 'next/image';

const FALLBACK_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#232323"/><text x="50%" y="50%" fill="#F7F5EE" font-family="sans-serif" font-size="40" text-anchor="middle" dominant-baseline="middle">Photo unavailable</text></svg>`,
  );

/**
 * Listing detail gallery. Photos are ALREADY §18.10-gated by the caller (full
 * set for Active; primary-only for Pending/Closed), so this component just
 * renders whatever it's given — it never decides how many photos are allowed.
 */
export default function ListingGallery({
  photos,
  alt,
}: {
  photos: string[];
  alt: string;
}) {
  const gallery = photos.length > 0 ? photos : [FALLBACK_IMAGE];
  const [idx, setIdx] = React.useState(0);
  const current = gallery[Math.min(idx, gallery.length - 1)] ?? FALLBACK_IMAGE;
  const hasMultiple = gallery.length > 1;

  return (
    <div>
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl bg-line-hair">
        <Image
          src={current}
          alt={alt}
          fill
          sizes="(max-width: 1024px) 100vw, 1024px"
          className="object-cover"
          unoptimized
          priority
        />
        {hasMultiple ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setIdx((i) => (i - 1 + gallery.length) % gallery.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-3 py-2 text-lg text-charcoal shadow hover:bg-white"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setIdx((i) => (i + 1) % gallery.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-3 py-2 text-lg text-charcoal shadow hover:bg-white"
            >
              ›
            </button>
            <span className="absolute bottom-3 right-3 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white">
              {Math.min(idx, gallery.length - 1) + 1}/{gallery.length}
            </span>
          </>
        ) : null}
      </div>

      {hasMultiple ? (
        <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-8">
          {gallery.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              aria-label={`View photo ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`relative aspect-[3/2] overflow-hidden rounded-md border-2 ${
                i === Math.min(idx, gallery.length - 1) ? 'border-platinum-red' : 'border-transparent'
              }`}
            >
              <Image src={src} alt="" fill sizes="120px" className="object-cover" unoptimized />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
