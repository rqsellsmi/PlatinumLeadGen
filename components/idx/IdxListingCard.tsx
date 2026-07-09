'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { IdxCard } from '@/lib/idx';
import { formatCurrency, formatMonthYear } from '@/lib/utils';
import RealcompLogo from './RealcompLogo';

const FALLBACK_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#232323"/><text x="50%" y="50%" fill="#F7F5EE" font-family="sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">Photo unavailable</text></svg>`,
  );

/**
 * A single IDX listing card (summary display). Compliance rules baked in:
 *  - Realcomp logo adjacent to the listing (§18.3.5)
 *  - listing office name shown (§18.2.12)
 *  - NO RE/MAX Platinum branding / agent contact inside the card body
 *    (§18.3.11 / §18.3.12)
 *  - Active listings may show the full photo set; Pending/Closed show the
 *    primary photo only (§18.10) — enforced by only passing `photos` for Active.
 */
export default function IdxListingCard({
  listing,
  variant,
  photos,
}: {
  listing: IdxCard;
  variant: 'sale' | 'sold';
  photos?: string[];
}) {
  const gallery =
    variant === 'sale' && photos && photos.length > 0
      ? photos
      : listing.photoUrl
        ? [listing.photoUrl]
        : [FALLBACK_IMAGE];
  const [idx, setIdx] = React.useState(0);
  const current = gallery[Math.min(idx, gallery.length - 1)] ?? FALLBACK_IMAGE;
  const hasMultiple = gallery.length > 1;

  const beds = listing.bedsTotal;
  const baths = listing.bathsTotal;
  const sqft = listing.livingArea;

  const saleToList =
    variant === 'sold' && listing.closePrice && listing.listPrice
      ? Math.round((listing.closePrice / listing.listPrice) * 100)
      : null;

  const href = `/listing/${encodeURIComponent(listing.listingKey)}`;

  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-[0_12px_32px_rgba(20,20,24,0.12)]"
    >
      <div className="relative h-52 w-full bg-line-hair">
        <Image
          src={current}
          alt={listing.address ?? 'Property photo'}
          width={600}
          height={400}
          className="h-52 w-full object-cover"
          unoptimized
          loading="lazy"
        />
        {/* Realcomp icon adjacent to the listing (§18.3.5). */}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 shadow-sm">
          <RealcompLogo size={16} />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-mute">MLS</span>
        </span>
        {listing.waterfrontYN ? (
          <span className="absolute right-2 top-2 rounded bg-platinum-blue/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Waterfront
          </span>
        ) : null}
        {hasMultiple ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIdx((i) => (i - 1 + gallery.length) % gallery.length);
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-2 py-1 text-charcoal shadow hover:bg-white"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIdx((i) => (i + 1) % gallery.length);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-2 py-1 text-charcoal shadow hover:bg-white"
            >
              ›
            </button>
            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {Math.min(idx, gallery.length - 1) + 1}/{gallery.length}
            </span>
          </>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-numeric text-xl font-bold text-charcoal">
            {formatCurrency(variant === 'sold' ? listing.closePrice : listing.listPrice)}
          </p>
          {variant === 'sold' && listing.closeDate ? (
            <p className="text-xs font-semibold text-mute">Sold {formatMonthYear(listing.closeDate)}</p>
          ) : null}
        </div>

        {saleToList != null ? (
          <p className="mt-0.5 text-xs text-mute">
            Sold {saleToList >= 100 ? `${saleToList - 100}% over` : `${100 - saleToList}% under`} asking
          </p>
        ) : null}

        <p className="mt-1 text-sm text-mute">
          {[
            beds != null ? `${beds} bd` : null,
            baths != null ? `${baths} ba` : null,
            sqft != null ? `${sqft.toLocaleString()} sqft` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {listing.address ? (
          <p className="mt-1 truncate text-sm font-medium text-charcoal">{listing.address}</p>
        ) : null}
        <p className="text-sm text-mute">{listing.city ?? ''}</p>

        <div className="mt-2 flex items-center justify-between text-[11px] text-mute-light">
          {variant === 'sale' && listing.daysOnMarket != null ? (
            <span>{listing.daysOnMarket} days on market</span>
          ) : (
            <span />
          )}
          {listing.waterFrontageFeet ? <span>{listing.waterFrontageFeet} ft frontage</span> : null}
        </div>

        {/* Listing office credit (§18.2.12) — the source brokerage, not ours. */}
        {listing.listingOfficeName ? (
          <p className="mt-2 border-t border-line-hair pt-2 text-[11px] text-mute-light">
            Listed by {listing.listingOfficeName}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
