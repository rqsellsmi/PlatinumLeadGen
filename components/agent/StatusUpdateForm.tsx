'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, Textarea, Label } from '@/components/ui';
import type { LeadStatus } from '@/components/agent/LeadList';
import { LOST_REASONS, lostReasonLabel, leadStatusLabel } from '@/lib/leadLifecycle';

// Statuses an agent can set. 'reopened' is set by intake, not here; a lead that
// is currently 'reopened' can still be moved forward to the others.
const SETTABLE: LeadStatus[] = [
  'new',
  'attempted_contact',
  'contacted',
  'qualified',
  'working',
  'closed',
  'lost',
];

export function StatusUpdateForm({
  leadOfferId,
  currentStatus,
  canMarkLost,
}: {
  leadOfferId: number;
  currentStatus: string;
  canMarkLost: boolean;
}) {
  const router = useRouter();
  const [newStatus, setNewStatus] = useState<LeadStatus>(
    (SETTABLE as readonly string[]).includes(currentStatus) ? (currentStatus as LeadStatus) : 'contacted',
  );
  const [lostReason, setLostReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lost is only offered once the lead has been contacted (spec v2 §4.2).
  const statusOptions = SETTABLE.filter((s) => s !== 'lost' || canMarkLost);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newStatus === 'lost' && !lostReason) {
      setError('Choose a reason for marking this lead lost.');
      return;
    }
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
          lostReason: newStatus === 'lost' ? lostReason : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          data?.error === 'must_contact_before_lost'
            ? 'Log a Contacted update (or 6 Attempted-contact updates) before marking this lead lost.'
            : 'Could not save the update. Please try again.',
        );
        return;
      }
      setNote('');
      setLostReason('');
      router.refresh();
    } catch {
      setError('Could not save the update. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {currentStatus === 'reopened' ? (
        <p className="rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-800">
          This lead came back — the client submitted again. Log a fresh Contacted before it can be
          marked lost again.
        </p>
      ) : null}
      <div>
        <Label htmlFor="newStatus">Status</Label>
        <Select
          id="newStatus"
          name="newStatus"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as LeadStatus)}
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {leadStatusLabel(s)}
            </option>
          ))}
        </Select>
        {!canMarkLost ? (
          <p className="mt-1 text-xs text-mute-light">
            &ldquo;Lost&rdquo; unlocks after you log a Contacted update, or 6 Attempted-contact
            updates.
          </p>
        ) : null}
      </div>

      {newStatus === 'lost' ? (
        <div>
          <Label htmlFor="lostReason">Reason (required)</Label>
          <Select
            id="lostReason"
            name="lostReason"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
          >
            <option value="" disabled>
              Choose a reason…
            </option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {lostReasonLabel(r)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

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
