'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { getLeadAttribution } from '@/lib/attribution';
import { isValidPersonName, INVALID_NAME_MESSAGE } from '@/lib/validation';

type Mode = 'showing' | 'contact';

const TIME_WINDOWS = ['Morning', 'Afternoon', 'Evening', 'Flexible'];

/**
 * Sticky "Schedule a showing" / "Contact an agent" bar for a listing detail page.
 * The bar follows the scroll; the buttons open a modal form that posts to
 * /api/buyer/inquiry (creates a buyer lead routed to the nearest agent).
 */
export default function ListingContact({
  listingKey,
  listingLabel,
}: {
  listingKey: string;
  listingLabel: string | null;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('showing');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [preferredDate, setPreferredDate] = React.useState('');
  const [preferredTime, setPreferredTime] = React.useState('');
  const [message, setMessage] = React.useState('');

  React.useEffect(() => setMounted(true), []);

  function launch(m: Mode) {
    setMode(m);
    setOpen(true);
    setDone(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !isValidPersonName(firstName)) return setError(INVALID_NAME_MESSAGE);
    if (lastName && !isValidPersonName(lastName)) return setError(INVALID_NAME_MESSAGE);
    if (!email.trim()) return setError('Enter your email so an agent can reach you.');

    setSubmitting(true);
    try {
      const res = await fetch('/api/buyer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingKey,
          kind: mode,
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          email: email.trim(),
          phone: phone.trim() || null,
          preferredDate: mode === 'showing' ? preferredDate || null : null,
          preferredTime: mode === 'showing' ? preferredTime || null : null,
          message: message.trim() || null,
          ...getLeadAttribution(),
        }),
      });
      if (!res.ok) throw new Error('request failed');
      setDone(true);
    } catch {
      setError('Something went wrong. Please try again or call our office.');
    } finally {
      setSubmitting(false);
    }
  }

  const bar = (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(20,20,24,0.08)] backdrop-blur sm:left-auto sm:right-6 sm:bottom-6 sm:inset-x-auto sm:rounded-2xl sm:border sm:px-4 sm:shadow-[0_18px_48px_rgba(20,20,24,0.18)]">
      <div className="mx-auto flex max-w-5xl items-center gap-2.5 sm:max-w-none">
        <button
          type="button"
          onClick={() => launch('showing')}
          className="flex-1 whitespace-nowrap rounded-pill bg-platinum-red px-5 py-3 text-sm font-bold text-white hover:bg-platinum-redHover sm:flex-none"
        >
          Schedule a showing
        </button>
        <button
          type="button"
          onClick={() => launch('contact')}
          className="flex-1 whitespace-nowrap rounded-pill border border-platinum-blue px-5 py-3 text-sm font-bold text-platinum-blue hover:bg-platinum-blue/5 sm:flex-none"
        >
          Contact an agent
        </button>
      </div>
    </div>
  );

  const modal = open ? (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-extrabold text-charcoal">
            {mode === 'showing' ? 'Schedule a showing' : 'Contact an agent'}
          </h2>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-2xl leading-none text-mute hover:text-charcoal">
            ×
          </button>
        </div>
        {listingLabel ? <p className="mt-1 text-sm text-mute">{listingLabel}</p> : null}

        {done ? (
          <div className="mt-6 rounded-xl bg-success-bg p-5 text-center">
            <p className="text-lg font-bold text-success">Request sent!</p>
            <p className="mt-1 text-sm text-charcoal">
              A local RE/MAX Platinum agent will reach out shortly.
            </p>
            <button type="button" onClick={() => setOpen(false)} className="mt-4 rounded-pill bg-platinum-blue px-5 py-2 text-sm font-semibold text-white">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="flex gap-3">
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className="w-full rounded-md border border-line px-3 py-2.5 text-sm" required />
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className="w-full rounded-md border border-line px-3 py-2.5 text-sm" />
            </div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className="w-full rounded-md border border-line px-3 py-2.5 text-sm" required />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Phone (optional)" className="w-full rounded-md border border-line px-3 py-2.5 text-sm" />
            {mode === 'showing' ? (
              <div className="flex gap-3">
                <label className="flex w-full flex-col text-xs font-semibold text-mute">
                  Preferred date
                  <input value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} type="date" className="mt-1 rounded-md border border-line px-3 py-2.5 text-sm" />
                </label>
                <label className="flex w-full flex-col text-xs font-semibold text-mute">
                  Time
                  <select value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} className="mt-1 rounded-md border border-line px-3 py-2.5 text-sm">
                    <option value="">Any time</option>
                    {TIME_WINDOWS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={mode === 'showing' ? 'Anything the agent should know? (optional)' : 'How can we help?'}
              rows={3}
              className="w-full rounded-md border border-line px-3 py-2.5 text-sm"
            />
            {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-pill bg-platinum-red px-5 py-3 text-sm font-bold text-white hover:bg-platinum-redHover disabled:opacity-60"
            >
              {submitting ? 'Sending…' : mode === 'showing' ? 'Request showing' : 'Send message'}
            </button>
            <p className="text-center text-[11px] text-mute-light">
              By submitting you agree to be contacted about this property.
            </p>
          </form>
        )}
      </div>
    </div>
  ) : null;

  if (!mounted) return null;
  return (
    <>
      {bar}
      {createPortal(modal, document.body)}
      {/* Spacer so the sticky bar doesn't cover page footer content on mobile. */}
      <div className="h-20 sm:h-0" aria-hidden />
    </>
  );
}
