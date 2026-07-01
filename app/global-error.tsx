'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown in the root layout itself (where the
 * normal app/error.tsx cannot render). Must include its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F7F8',
          margin: 0,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            background: '#fff',
            border: '1px solid #E2E2E6',
            borderRadius: 13,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#232323', margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: '#54545C' }}>
            The application failed to start. This usually means a missing environment variable or a
            database connection problem on this deployment.
          </p>
          {error.digest ? (
            <p style={{ marginTop: 12, fontSize: 12, color: '#A0A0AA' }}>Reference: {error.digest}</p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              background: '#FF1200',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
