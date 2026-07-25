'use client';

import * as React from 'react';
import Image from 'next/image';
import PhotoLightbox from './PhotoLightbox';

const FALLBACK_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#232323"/><text x="50%" y="50%" fill="#F7F5EE" font-family="sans-serif" font-size="40" text-anchor="middle" dominant-baseline="middle">Photo unavailable</text></svg>`,
  );

/**
 * Listing detail hero with a scrollable photo carousel in the primary-photo slot
 * and click-to-enlarge lightbox — the same overlaid status badge / eyebrow /
 * address / price as the static ListingHero. Client component. No RE/MAX branding
 * inside the listing body per §18.3.12.
 */
export default function ListingHeroCarousel({
  photos,
  alt,
  badge,
  badgeTone,
  eyebrow,
  address,
  cityLine,
  price,
  priceNote,
  primaryOnlyNote,
}: {
  photos: string[];
  alt: string;
  badge: string;
  badgeTone: 'sold' | 'active';
  eyebrow?: string | null;
  address: string | null;
  cityLine: string;
  price: string;
  priceNote?: string | null;
  primaryOnlyNote?: boolean;
}) {
  const gallery = photos.length ? photos : [FALLBACK_IMAGE];
  const [idx, setIdx] = React.useState(0);
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const hasMultiple = gallery.length > 1;
  const current = gallery[Math.min(idx, gallery.length - 1)];

  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl bg-line-hair sm:aspect-[16/9]">
      <button
        type="button"
        onClick={() => setLightbox(idx)}
        className="absolute inset-0 h-full w-full cursor-zoom-in"
        aria-label="Enlarge photo"
      >
        <Image
          src={current}
          alt={alt}
          fill
          sizes="(max-width: 1024px) 100vw, 1024px"
          className="object-cover"
          unoptimized
          priority
        />
      </button>

      {/* Legibility gradient (top + bottom). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/75" />

      {/* Top row: status badge + MLS photo note. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-white ${
            badgeTone === 'sold' ? 'bg-success' : 'bg-platinum-red'
          }`}
        >
          <span aria-hidden className="text-[9px]">
            ●
          </span>
          {badge}
        </span>
        {primaryOnlyNote ? (
          <span className="max-w-[45%] text-right text-[11px] font-medium leading-tight text-white/85">
            Per MLS, one photo shown for sold listings
          </span>
        ) : null}
      </div>

      {/* Prev/next + counter (multiple photos only). */}
      {hasMultiple ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => setIdx((i) => (i - 1 + gallery.length) % gallery.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-3 py-2 text-charcoal shadow hover:bg-white"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => setIdx((i) => (i + 1) % gallery.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-3 py-2 text-charcoal shadow hover:bg-white"
          >
            ›
          </button>
          <span className="pointer-events-none absolute right-4 top-4 rounded bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
            {Math.min(idx, gallery.length - 1) + 1} / {gallery.length}
          </span>
        </>
      ) : null}

      {/* Bottom row: location + address (left), price (right). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 p-4 sm:p-6">
        <div className="min-w-0">
          {eyebrow ? <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/85">{eyebrow}</p> : null}
          {address ? (
            <h1 className="mt-0.5 text-2xl font-black uppercase leading-tight tracking-tight text-white sm:text-4xl">
              {address}
            </h1>
          ) : null}
          <p className="mt-0.5 text-sm text-white/85">{cityLine}</p>
        </div>
        <div className="text-right">
          <p className="font-numeric text-2xl font-black text-white sm:text-4xl">{price}</p>
          {priceNote ? <p className="mt-0.5 text-xs font-semibold text-white/85">{priceNote}</p> : null}
        </div>
      </div>

      <PhotoLightbox photos={gallery} openIndex={lightbox} onClose={() => setLightbox(null)} alt={alt} />
    </div>
  );
}
