'use client';

import * as React from 'react';
import { Button } from '@/components/ui';
import { launchAgentInvites } from '@/app/admin/agents/actions';

/**
 * The one-time Launch send (decision D7).
 *
 * Emails a unique, single-use, expiring invite to every active agent who has no
 * password yet, and sets the roster to opt-in availability. Replaces handing
 * out one shared setup code.
 *
 * Two guards, because this is a bulk outbound email to the whole roster and
 * there is no undo:
 *   - a typed confirmation before the first run;
 *   - `launchInvitesSentAt`, checked server-side, so a second click cannot
 *     mass-re-email everyone. Re-running after that is possible but explicit.
 */
export default function LaunchInvitesPanel({
  pendingCount,
  sentAt,
}: {
  /** Active agents with no password yet — the people who would be emailed. */
  pendingCount: number;
  /** When the launch send already ran, if it has. */
  sentAt: Date | null;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [typed, setTyped] = React.useState('');

  if (sentAt) {
    return (
      <div className="rounded-card border border-line bg-white px-5 py-4">
        <p className="text-sm font-semibold text-charcoal">Launch invitations sent</p>
        <p className="mt-1 text-sm text-mute">
          The one-time send ran on {sentAt.toLocaleDateString()}.{' '}
          {pendingCount > 0
            ? `${pendingCount} active agent${pendingCount === 1 ? ' has' : 's have'} still not set a password.`
            : 'Every active agent has set up their account.'}
        </p>
        {pendingCount > 0 ? (
          <p className="mt-2 text-sm text-mute">
            They&apos;re flagged <strong>Needs setup</strong> below. Launch links expire after 7
            days, so anyone who left the email unopened needs a fresh one — open their agent page
            and use <strong>Send a new setup invite</strong>. Do that rather than re-running the
            bulk send, which would re-email the whole roster.
          </p>
        ) : null}
      </div>
    );
  }

  if (pendingCount === 0) {
    return null;
  }

  return (
    <div className="rounded-card border border-line bg-white px-5 py-4">
      <p className="text-sm font-semibold text-charcoal">Launch the agent portal</p>
      <p className="mt-1 text-sm text-mute">
        Emails a personal, single-use setup link to{' '}
        <strong>
          {pendingCount} active agent{pendingCount === 1 ? '' : 's'}
        </strong>{' '}
        who {pendingCount === 1 ? 'has' : 'have'} not set a password yet. Agents who are already
        set up are skipped. This runs once — check the roster and mark departed agents inactive
        first.
      </p>
      <p className="mt-2 text-sm text-mute">
        This does not change anyone&apos;s lead routing. Agents turn their own availability on in
        their portal once they&apos;ve set a password and accepted the referral terms.
      </p>

      {confirming ? (
        <form action={launchAgentInvites} className="mt-4 space-y-3">
          <label className="block text-sm text-charcoal">
            Type <strong>LAUNCH</strong> to confirm:
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 block w-40 rounded-lg border border-line px-3 py-2 text-sm"
              autoComplete="off"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={typed.trim().toUpperCase() !== 'LAUNCH'}>
              Send {pendingCount} invitation{pendingCount === 1 ? '' : 's'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <Button type="button" onClick={() => setConfirming(true)}>
            Launch…
          </Button>
        </div>
      )}
    </div>
  );
}
