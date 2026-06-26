import Script from 'next/script';
import type { TrackingScript } from '@/drizzle/schema';

interface TrackingScriptsProps {
  scripts: TrackingScript[];
}

/**
 * Renders admin-managed tracking snippets (GTM and similar).
 *
 * SECURITY NOTE (Section 4.3 #10): scriptContent is authored exclusively by
 * trusted admins through the protected admin surface. It is therefore safe to
 * inject via dangerouslySetInnerHTML; this content is never user-supplied.
 */
export default function TrackingScripts({ scripts }: TrackingScriptsProps) {
  const active = scripts.filter((s) => s.isActive);
  if (!active.length) return null;

  return (
    <>
      {active.map((s) => (
        <Script
          key={s.id}
          id={`tracking-script-${s.id}`}
          strategy="afterInteractive"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: s.scriptContent }}
        />
      ))}
    </>
  );
}
