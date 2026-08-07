'use client';

import * as React from 'react';
import Image from 'next/image';

/**
 * Branded placeholder for a property photo we cannot show. Inline SVG rather than
 * a file so it needs no network request of its own — the point is to be the thing
 * that renders when a request has already failed.
 */
export const PROPERTY_FALLBACK_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#232323"/><text x="50%" y="50%" fill="#F7F5EE" font-family="sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">RE/MAX Platinum</text></svg>`,
  );

/**
 * A property photo that degrades to the branded placeholder when the image fails
 * to LOAD, not merely when the URL is absent.
 *
 * Every caller already handled `photoUrl == null`. None handled the other case:
 * a URL that exists and 404s. Realcomp photo URLs go dead between syncs, and when
 * one does, the browser paints the alt text across an empty grey box — on a city
 * page that showed "Recently sold home at 1612 S Hughes Road" as raw text where
 * the photo should be.
 *
 * The alt text stays for screen readers; it just stops being the visual.
 *
 * Client component because onError only exists in the browser. Keep it small: it
 * ships to every page that renders a listing photo.
 */
export default function PropertyImage({
  src,
  alt,
  className,
  fill,
  width,
  height,
  sizes,
  priority,
  loading,
  unoptimized,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  loading?: 'lazy' | 'eager';
  unoptimized?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);

  // Galleries swap src on the same mounted component, so a previous failure must
  // not condemn the next photo.
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const resolved = !src || failed ? PROPERTY_FALLBACK_IMAGE : src;

  const common = {
    src: resolved,
    alt,
    className,
    sizes,
    priority,
    loading,
    unoptimized,
    onError: () => setFailed(true),
  } as const;

  return fill ? (
    <Image {...common} fill />
  ) : (
    <Image {...common} width={width ?? 600} height={height ?? 400} />
  );
}
