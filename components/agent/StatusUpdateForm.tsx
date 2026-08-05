'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, Textarea, Label } from '@/components/ui';
import {
  ALLOWED_TRANSITIONS,
  leadStatusLabel,
  lostReasonsForOrigin,
  v4LostReasonLabel,
} from '@/lib/leadLifecycle';

/**
 * Agent status/activity logger (Scoring v4). The status options are exactly the
 * moves allowed from the lead's current stage (ALLOWED_TRANSITIONS); the Lost
 * reason list is the origin-scoped set the server computed for this stage.
 *
 * The pre-selected option is `options[0]`, and ALLOWED_TRANSITIONS now lists each
 * working stage FIRST in its own list — so the default is "no change, just
 * logging an update". That is the common case (a periodic check-in on a lead
 * that hasn't moved) and it should cost zero clicks: open the lead, optionally
 * type a note, save.
 *
 * It also removes a real hazard. The default used to be the NEXT stage, so
 * saving a note without touching the dropdown advanced the lead — from Signed
 * that meant Closed Won, worth +25 and an outbound Google Ads conversion.
 *
 * THE FORM DOES NOT WAIT FOR router.refresh() TO KNOW WHERE THE LEAD IS.
 * It used to: `options` came from the `currentStatus` prop, but the selected
 * value was `useState(options[0])`, whose initializer runs ONCE on mount. After
 * a save the component is re-rendered, never remounted, so the picker kept the
 * old selection — and if the refresh was slow or did not land (this page also
 * awaits an external property-record lookup on every render), the dropdown went
 * on offering moves from the PREVIOUS stage. An agent who logged Connected
 * could not then pick Nurturing, because it was not in the stale list, and
 * anything they could pick was rejected server-side as an illegal transition.
 *
 * The stage the form works from is now local state that (a) adopts the server's
 * value whenever it arrives, and (b) advances the moment a save succeeds. The
 * next move is available immediately; the refresh only reconciles the rest of
 * the page. The server still validates every transition, so this can never
 * authorise a move — only offer one.
 */
export function StatusUpdateForm({
  leadOfferId,
  currentStatus,
  attemptedContactCount,
}: {
  leadOfferId: number;
  currentStatus: string;
  /**
   * Attempted-contact logs in the current working cycle. Passed instead of a
   * resolved reason list so the Lost reasons stay correct after an optimistic
   * stage change too — a server-computed list would describe the stage the lead
   * was at before the save (v4 §6).
   */
  attemptedContactCount: number;
}) {
  const router = useRouter();

  // What the form believes the lead's stage is. Seeded from the server, updated
  // on a successful save, and re-adopted whenever the server sends a new value.
  const [stage, setStage] = useState(currentStatus);
  const [attempts, setAttempts] = useState(attemptedContactCount);
  const [newStatus, setNewStatus] = useState<string>(
    () => (ALLOWED_TRANSITIONS[currentStatus] ?? [])[0] ?? '',
  );
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server is authoritative whenever it speaks.
  useEffect(() => setStage(currentStatus), [currentStatus]);
  useEffect(() => setAttempts(attemptedContactCount), [attemptedContactCount]);

  const options = [...(ALLOWED_TRANSITIONS[stage] ?? [])];
  const lostReasons = lostReasonsForOrigin(stage, attempts);

  // Keep the picker on a legal option for the stage we are actually at. This is
  // the resync the useState initializer cannot do on its own.
  useEffect(() => {
    const next = (ALLOWED_TRANSITIONS[stage] ?? [])[0] ?? '';
    setNewStatus(next);
    setLostReason('');
  }, [stage]);

  if (options.length === 0) {
    return (
      <p className="text-sm text-mute">
        This lead is {leadStatusLabel(stage)} — no further updates needed.
      </p>
    );
  }

  const showBackHint =
    newStatus === 'nurturing' && (stage === 'appointment_set' || stage === 'signed');

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
      // Advance the form immediately. The save succeeded, so the lead IS at
      // `newStatus` now — the agent should be able to make the next move
      // without waiting for the page to come back, or reaching for refresh.
      if (newStatus === 'attempted_contact') setAttempts((n) => n + 1);
      setStage(newStatus);
      // Still refresh, to reconcile the rest of the page (badge, timeline).
      router.refresh();
    } catch {
      setError('Could not save the update. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {stage === 'reopened' ? (
        <p className="rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-800">
          This lead came back — the client submitted again. Work it like a new lead.
        </p>
      ) : null}
      <div>
        <Label htmlFor="newStatus">Stage</Label>
        <Select
          id="newStatus"
          name="newStatus"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value)}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {s === stage
                ? `${leadStatusLabel(s)} — no change (just logging an update)`
                : leadStatusLabel(s)}
            </option>
          ))}
        </Select>
        {newStatus === stage ? (
          <p className="mt-1 text-xs text-mute-light">
            Leaves the lead where it is and resets the update clock. Add a note if you have
            one — it&apos;s optional.
          </p>
        ) : null}
        {/* Lost isn't reachable from New, so an agent who came here to close out a
            dead contact was told a moment ago that it wasn't an option. Once
            they've logged the attempt it quietly becomes one — say so, rather
            than leaving it in a dropdown they've already closed. */}
        {stage === 'attempted_contact' && options.includes('lost') ? (
          <p className="mt-1 text-xs text-mute-light">
            If the number or email turned out to be bad, you can now mark this lead{' '}
            <span className="font-semibold">Lost</span> and pick that as the reason.
          </p>
        ) : null}
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
