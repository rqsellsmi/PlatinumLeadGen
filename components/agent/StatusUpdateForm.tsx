'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, Textarea, Label } from '@/components/ui';
import type { LeadStatus } from '@/components/agent/LeadList';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'closed', 'lost'];

export function StatusUpdateForm({
  leadOfferId,
  currentStatus,
}: {
  leadOfferId: number;
  currentStatus: LeadStatus;
}) {
  const router = useRouter();
  const [newStatus, setNewStatus] = useState<LeadStatus>(currentStatus);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadOfferId,
          newStatus,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError('Could not save the update. Please try again.');
        return;
      }
      setNote('');
      router.refresh();
    } catch {
      setError('Could not save the update. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="newStatus">Status</Label>
        <Select
          id="newStatus"
          name="newStatus"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as LeadStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea
          id="note"
          name="note"
          rows={3}
          value={note}
          placeholder="Add context about this update…"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && (
        <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-platinum-red">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Save update'}
      </Button>
    </form>
  );
}
