'use client';

import * as React from 'react';
import { useFavorites } from './useFavorites';

/**
 * Heart toggle for a listing. Signed-out clicks open the sign-in modal (the
 * store handles that); signed-in clicks optimistically favorite/unfavorite.
 * Used on listing cards (overlay) and the detail page (inline).
 */
export default function FavoriteButton({
  listingKey,
  next,
  variant = 'overlay',
  className = '',
}: {
  listingKey: string;
  /** Where to return after signing in (defaults to the current URL). */
  next?: string;
  variant?: 'overlay' | 'inline';
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(listingKey);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const back = next ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/account');
    void toggle(listingKey, back);
  };

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={active ? 'Remove from saved homes' : 'Save this home'}
        className={`inline-flex items-center gap-2 rounded-pill border px-4 py-2 text-sm font-bold transition-colors ${
          active
            ? 'border-platinum-red bg-platinum-red text-white'
            : 'border-line bg-white text-charcoal hover:border-platinum-red'
        } ${className}`}
      >
        <Heart filled={active} />
        {active ? 'Saved' : 'Save'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? 'Remove from saved homes' : 'Save this home'}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white ${
        active ? 'text-platinum-red' : 'text-charcoal'
      } ${className}`}
    >
      <Heart filled={active} />
    </button>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s-6.5-4.35-9.33-8.02C.9 10.36 1.4 6.9 4.1 5.4a4.6 4.6 0 0 1 5.9 1.1L12 8.2l2-1.7a4.6 4.6 0 0 1 5.9-1.1c2.7 1.5 3.2 4.96 1.43 7.58C18.5 16.65 12 21 12 21Z"
      />
    </svg>
  );
}
