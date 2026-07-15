'use client';

import { useRouter } from 'next/navigation';

/**
 * "← Back" for the listing detail page. Uses browser history so a lead who
 * opened a listing from their valuation report returns to the valuation (which
 * re-renders from the saved report token — no new AVM call). Falls back to the
 * homepage when there's no history to go back to.
 */
export default function ListingBackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push('/');
      }}
      className="text-sm font-semibold text-platinum-blue hover:underline"
    >
      ← Back
    </button>
  );
}
