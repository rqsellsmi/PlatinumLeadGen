'use client';

import * as React from 'react';
import Link from 'next/link';
import { describeSearch, filtersToQuery, type SearchFilters } from '@/lib/listingSearch';

export interface SavedSearchItem {
  id: number;
  name: string;
  filters: SearchFilters;
}

/**
 * The account "Saved searches" list: each row links back to live results and can
 * be deleted. Deletes are scoped server-side to the signed-in buyer; here we
 * just optimistically drop the row.
 */
export default function SavedSearchList({ initial }: { initial: SavedSearchItem[] }) {
  const [items, setItems] = React.useState(initial);

  async function remove(id: number) {
    setItems((xs) => xs.filter((x) => x.id !== id)); // optimistic
    try {
      await fetch('/api/buyer/saved-searches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* best-effort; a stale row will disappear on next load */
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-cream/50 px-6 py-12 text-center text-sm text-mute">
        No saved searches yet. Run a search and tap &ldquo;Save this search&rdquo; to keep it here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-white">
      {items.map((s) => {
        const query = filtersToQuery(s.filters);
        return (
          <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-charcoal">{s.name || describeSearch(s.filters)}</p>
              <Link href={`/homes${query ? `?${query}` : ''}`} className="text-sm font-medium text-platinum-blue hover:underline">
                View matching homes →
              </Link>
            </div>
            <button
              type="button"
              onClick={() => remove(s.id)}
              className="shrink-0 text-sm font-medium text-mute hover:text-danger"
              aria-label={`Delete saved search ${s.name}`}
            >
              Remove
            </button>
          </li>
        );
      })}
    </ul>
  );
}
