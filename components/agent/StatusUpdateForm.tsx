'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, Textarea, Label } from '@/components/ui';
import { ALLOWED_TRANSITIONS, leadStatusLabel, v4LostReasonLabel } from '@/lib/leadLifecycle';

/**
 * Agent status/activity logger (Scoring v4). The status options are exactly the
 * moves allowed from the lead's current stage (ALLOWED_TRANSITIONS); the Lost
 * reason list is the origin-scoped set the server computed for this stage.
 */
export function StatusUpdateForm({
  leadOfferId,
  currentStatus,
  lostReasons,
}: {
  leadOfferId: number;
  currentStatus: string;
  /** Valid Lost reasons for the current origin status (server-computed, v4 §6). */
  lostReasons: string[];
}) {
  const router = useRouter();
  const options = [...(ALLOWED_TRANSITIONS[currentStatus] ?? [])];
  const [newStatus, setNewStatus] = useState<string>(options[0] ?? '');
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) {
    return (
      <p className="text-sm text-mute">
        This lead is {leadStatusLabel(currentStatus)} — no further updates needed.
      </p>
    );
  }

  const showBackHint =
    newStatus === 'nurturing' && (currentStatus === 'appointment_set' || currentStatus === 'signed');

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
          data?.error === 'invalid_transition'
            ? 'That move isn’t allowed from the current stage.'
            : data?.error === 'lost_reason_required'
              ? 'Choose a valid reason to mark this lead lost.'
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
          This lead came back — the client submitted again. Work it like a new lead.
        </p>
      ) : null}
      <div>
        <Label htmlFor="newStatus">Move to</Label>
        <Select
          id="newStatus"
          name="newStatus"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value)}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {leadStatusLabel(s)}
            </option>
          ))}
        </Select>
        {showBackHint ? (
          <p className="mt-1 text-xs text-mute-light">
            Moving back to Nurturing keeps the lead active (e.g. the appointment or deal fell
            through).
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
            {lostReasons.map((r) => (
              <option key={r} value={r}>
                {v4LostReasonLabel(r)}
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
