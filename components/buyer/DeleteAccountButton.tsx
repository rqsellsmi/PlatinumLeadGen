'use client';

import * as React from 'react';

/**
 * Delete-my-account control (account page). Two-step confirm, then POSTs the
 * deletion and returns home. Removes saved homes/searches/views and unlinks the
 * account from any lead.
 */
export default function DeleteAccountButton() {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    setBusy(true);
    try {
      await fetch('/api/buyer/account/delete', { method: 'POST' });
    } catch {
      /* proceed to redirect regardless */
    }
    window.location.href = '/';
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-mute hover:text-danger">
        Delete my account
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-charcoal">
        This removes your saved homes, saved searches, and history. This can’t be undone.
      </p>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded-pill bg-danger px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'Deleting…' : 'Yes, delete my account'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-sm font-medium text-mute hover:text-charcoal">
        Cancel
      </button>
    </div>
  );
}
