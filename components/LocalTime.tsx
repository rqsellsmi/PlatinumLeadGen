'use client';

import * as React from 'react';

/**
 * Renders a timestamp in the viewer's LOCAL time zone. Because the server can't
 * know the visitor's zone, it renders America/New_York (Eastern) on the server
 * and during first hydration — a deterministic value that matches the SSR HTML
 * — then re-renders in the browser's actual zone after mount. So: local time
 * when we can determine it, Eastern otherwise. (Site-wide time display.)
 */
export default function LocalTime({
  value,
  dateOnly = false,
  fallback = '—',
}: {
  value: string | Date | null | undefined;
  dateOnly?: boolean;
  fallback?: string;
}) {
  const iso = value == null ? null : typeof value === 'string' ? value : value.toISOString();

  const format = React.useCallback(
    (timeZone: string | undefined) => {
      if (!iso) return fallback;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return fallback;
      const opts: Intl.DateTimeFormatOptions = dateOnly
        ? { year: 'numeric', month: 'numeric', day: 'numeric' }
        : {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          };
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(d);
    },
    [iso, dateOnly, fallback],
  );

  // Server + first client render: Eastern (deterministic, avoids hydration
  // mismatch). After mount: the browser's local zone.
  const [display, setDisplay] = React.useState(() => format('America/New_York'));
  React.useEffect(() => {
    setDisplay(format(undefined));
  }, [format]);

  return <time suppressHydrationWarning>{display}</time>;
}
