'use client';

import * as React from 'react';
import { emitListingHover, onListingHover } from '@/lib/listingHover';

/**
 * Wraps a results-list card: emits a hover event so the map can highlight the
 * matching pin, and rings itself when its pin is hovered on the map. Server-
 * rendered card is passed as children, so no server → client conversion needed.
 */
export default function HoverListingCard({
  listingKey,
  children,
}: {
  listingKey: string;
  children: React.ReactNode;
}) {
  const [active, setActive] = React.useState(false);

  React.useEffect(
    () =>
      onListingHover((p) => {
        if (p.from !== 'map') return; // only react to pin hovers
        setActive(p.key === listingKey);
      }),
    [listingKey],
  );

  return (
    <div
      onMouseEnter={() => emitListingHover(listingKey, 'card')}
      onMouseLeave={() => emitListingHover(null, 'card')}
      className={`rounded-lg transition-shadow ${
        active ? 'ring-2 ring-platinum-blue ring-offset-1' : ''
      }`}
    >
      {children}
    </div>
  );
}
