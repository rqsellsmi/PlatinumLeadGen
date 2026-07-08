'use client';

import * as React from 'react';
import { Button } from '@/components/ui';
import { runSyncNow, type RunSyncResult } from './actions';

/** "Run Sync Now" — triggers an incremental IDX sync via admin auth (§2.7). */
export default function RunSyncButton() {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<RunSyncResult | null>(null);

  async function onClick() {
    setPending(true);
    setResult(null);
    try {
      setResult(await runSyncNow());
    } catch {
      setResult({ ok: false, message: 'Request failed.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={onClick} disabled={pending}>
        {pending ? 'Syncing…' : 'Run Sync Now'}
      </Button>
      {result ? (
        <p className={`text-sm ${result.ok ? 'text-success' : 'text-platinum-red'}`}>{result.message}</p>
      ) : null}
    </div>
  );
}
