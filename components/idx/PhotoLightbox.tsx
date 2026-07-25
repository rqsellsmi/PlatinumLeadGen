'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * Full-screen photo lightbox. Controlled: pass `openIndex` (null = closed) and
 * `onClose`. Supports arrow-key / on-screen prev-next and Escape to close.
 */
export default function PhotoLightbox({
  photos,
  openIndex,
  onClose,
  alt,
}: {
  photos: string[];
  openIndex: number | null;
  onClose: () => void;
  alt: string;
}) {
  const [idx, setIdx] = React.useState(openIndex ?? 0);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (openIndex != null) setIdx(openIndex);
  }, [openIndex]);

  const open = openIndex != null;
  const prev = React.useCallback(() => setIdx((i) => (i - 1 + photos.length) % photos.length), [photos.length]);
  const next = React.useCallback(() => setIdx((i) => (i + 1) % photos.length), [photos.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, prev, next, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-2xl leading-none text-white hover:bg-white/20"
      >
        ×
      </button>
      {photos.length > 1 ? (
        <span className="absolute top-5 left-1/2 -translate-x-1/2 rounded bg-black/50 px-2 py-1 text-sm font-medium text-white">
          {idx + 1} / {photos.length}
        </span>
      ) : null}

      {photos.length > 1 ? (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-4 py-3 text-2xl text-white hover:bg-white/20 sm:left-6"
        >
          ‹
        </button>
      ) : null}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[idx]}
        alt={`${alt} — photo ${idx + 1}`}
        className="max-h-[88vh] max-w-[92vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {photos.length > 1 ? (
        <button
          type="button"
          aria-label="Next photo"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-4 py-3 text-2xl text-white hover:bg-white/20 sm:right-6"
        >
          ›
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
