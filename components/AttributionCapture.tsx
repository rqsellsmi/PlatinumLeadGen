'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { getLeadAttribution } from '@/lib/attribution';

/**
 * Captures + persists attribution on every public page load (v1.6 §C.4).
 * No-ops on /admin and /agent. getLeadAttribution() reads URL params, merges with
 * stored first-touch, and writes back to local/session storage.
 */
export default function AttributionCapture() {
  const pathname = usePathname() ?? '';
  React.useEffect(() => {
    if (pathname.startsWith('/admin') || pathname.startsWith('/agent')) return;
    getLeadAttribution();
  }, [pathname]);
  return null;
}
