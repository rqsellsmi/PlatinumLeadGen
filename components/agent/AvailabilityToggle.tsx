'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Toggle } from '@/components/ui';

/**
 * Agent-controlled lead routing toggle (Section 16.4). Lives in the portal
 * sidebar, styled per the Charcoal Light panel pattern. Optimistic update,
 * then router.refresh() so the header pill (server-rendered) stays in sync.
 */
export default function AvailabilityToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [available, setAvailable] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  async function toggle(next: boolean) {
    setAvailable(next);
    setBusy(true);
    try {
      const res = await fetch('/api/agent/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: next }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setAvailable(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card bg-charcoal-light p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-mute-lighter">
          Lead routing
        </span>
        <Toggle checked={available} onChange={toggle} disabled={busy} label="Toggle lead routing" />
      </div>
      <p className="mt-2 text-xs text-mute-lighter">
        {available
          ? "You're receiving new leads."
          : 'New leads are paused. You can still see and work your current leads.'}
      </p>
    </div>
  );
}
