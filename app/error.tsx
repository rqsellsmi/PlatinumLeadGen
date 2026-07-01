'use client';

import { useEffect } from 'react';

/**
 * App-level error boundary. Catches thrown errors from pages and nested
 * layouts (e.g. a failed DB query or missing environment variable in
 * production) and shows a branded, actionable message instead of the bare
 * "Application error" screen. The real stack is in the server logs; in
 * production Next only exposes the `digest` id here for correlation.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-offwhite px-6">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-2xl text-platinum-red">
          !
        </div>
        <h1 className="mt-4 text-xl font-bold text-charcoal">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          This page couldn&apos;t load. If it just started happening after a deploy, the app is
          usually missing an environment variable or can&apos;t reach the database on this
          deployment — check the server logs for details.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-mute-lighter">Reference: {error.digest}</p>
        ) : null}
        <button
          onClick={reset}
          className="mt-6 inline-flex items-center justify-center rounded-pill bg-platinum-red px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-platinum-redHover"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
