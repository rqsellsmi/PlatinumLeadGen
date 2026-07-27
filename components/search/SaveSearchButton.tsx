'use client';

import * as React from 'react';
import { openBuyerSignIn } from '@/components/buyer/SignInModal';
import { askRepresentation } from '@/components/buyer/RepresentationModal';

/**
 * "Save this search" on the results page. Persists the current filter set to the
 * signed-in buyer's account; a signed-out click (401) opens the sign-in modal
 * and returns here. The raw query params are sent as-is — the server normalizes
 * and derives the display name.
 */
export default function SaveSearchButton({ filters }: { filters: Record<string, string | string[]> }) {
  const [state, setState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/buyer/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      if (res.status === 401) {
        setState('idle');
        openBuyerSignIn(window.location.pathname + window.location.search);
        return;
      }
      if (!res.ok) throw new Error('failed');
      setState('saved');
      // First lead-creating save → ask representation, then re-submit so the
      // lead routes correctly. The search itself is already saved.
      const data = await res.json().catch(() => null);
      if (data?.needsRepresentation && data?.search?.id) {
        const answer = await askRepresentation();
        if (answer) {
          await fetch('/api/buyer/engage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'saved_search', savedSearchId: data.search.id, representation: answer }),
          }).catch(() => {});
        }
      }
    } catch {
      setState('error');
    }
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={state === 'saving' || state === 'saved'}
      className={`inline-flex items-center gap-2 rounded-pill border px-4 py-2 text-sm font-bold transition-colors ${
        state === 'saved'
          ? 'border-success bg-success/10 text-success'
          : 'border-line bg-white text-charcoal hover:border-platinum-blue disabled:opacity-60'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={state === 'saved' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-4-7 4V5Z" />
      </svg>
      {state === 'saved' ? 'Search saved' : state === 'saving' ? 'Saving…' : state === 'error' ? 'Try again' : 'Save this search'}
    </button>
  );
}
