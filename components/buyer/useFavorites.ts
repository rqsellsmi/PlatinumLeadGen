'use client';

import * as React from 'react';
import { openBuyerSignIn } from './SignInModal';
import { askRepresentation } from './RepresentationModal';

/**
 * A tiny module-level favorites store so every heart on a page shares one fetch
 * and stays in sync, instead of each card hitting the API. The set of favorited
 * listing keys is loaded once (lazily) and mutated optimistically on toggle.
 * A 401 means "signed out" — the store stays empty and a toggle opens sign-in.
 */
type State = { loaded: boolean; signedIn: boolean; keys: Set<string> };

let state: State = { loaded: false, signedIn: false, keys: new Set() };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  emit();
}

async function ensureLoaded() {
  if (state.loaded || inflight) return inflight ?? Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('/api/buyer/favorites');
      if (res.status === 401) {
        setState({ loaded: true, signedIn: false, keys: new Set() });
        return;
      }
      const data = await res.json();
      setState({ loaded: true, signedIn: true, keys: new Set<string>(data.favorites ?? []) });
    } catch {
      setState({ loaded: true, signedIn: false, keys: new Set() });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function toggle(listingKey: string, next: string) {
  if (!state.signedIn) {
    openBuyerSignIn(next);
    return;
  }
  const has = state.keys.has(listingKey);
  const keys = new Set(state.keys);
  if (has) keys.delete(listingKey);
  else keys.add(listingKey);
  setState({ keys }); // optimistic

  try {
    const res = await fetch('/api/buyer/favorites', {
      method: has ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingKey }),
    });
    if (!res.ok) throw new Error('failed');
    // First lead-creating save → ask the representation question, then re-submit
    // so the lead routes correctly. The favorite itself is already stored.
    if (!has) {
      const data = await res.json().catch(() => null);
      if (data?.needsRepresentation) {
        const answer = await askRepresentation();
        if (answer) {
          await fetch('/api/buyer/engage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'favorite', listingKey, representation: answer }),
          }).catch(() => {});
        }
      }
    }
  } catch {
    // revert on failure
    const reverted = new Set(state.keys);
    if (has) reverted.add(listingKey);
    else reverted.delete(listingKey);
    setState({ keys: reverted });
  }
}

/** Subscribe a component to the favorites store. */
export function useFavorites() {
  const [, force] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    void ensureLoaded();
    return () => {
      listeners.delete(force);
    };
  }, []);
  return {
    loaded: state.loaded,
    signedIn: state.signedIn,
    isFavorite: (key: string) => state.keys.has(key),
    toggle,
  };
}
