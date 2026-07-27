'use client';

import * as React from 'react';

/**
 * Fire-and-forget listing-view beacon, mounted on the listing detail page. Posts
 * once per mount; the server records it only for signed-in buyers (204 otherwise)
 * and never blocks on the result. Deduped per (buyer, listing) server-side.
 */
export default function ViewTracker({ listingKey }: { listingKey: string }) {
  React.useEffect(() => {
    if (!listingKey) return;
    fetch('/api/buyer/track-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingKey }),
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  }, [listingKey]);
  return null;
}
