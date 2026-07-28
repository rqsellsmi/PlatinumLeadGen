'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/** Why the sign-in modal opened — drives the modal + magic-link email copy. */
export type SignInReason = 'favorite' | 'save_search' | 'account';

/** Fire to open the buyer sign-in modal from anywhere. detail.next = post-login path. */
export const OPEN_BUYER_SIGNIN = 'open-buyer-signin';

export function openBuyerSignIn(next?: string, reason?: SignInReason) {
  window.dispatchEvent(new CustomEvent(OPEN_BUYER_SIGNIN, { detail: { next, reason } }));
}

// Per-reason modal copy (the email mirrors this via the `reason` it's sent).
const REASON_COPY: Record<SignInReason, { title: string; blurb: string }> = {
  favorite: { title: 'Save this home', blurb: 'Sign in to save homes — it’s free, no password.' },
  save_search: { title: 'Save your search', blurb: 'Sign in to save searches — it’s free, no password.' },
  account: { title: 'Sign in', blurb: 'Sign in to save homes and searches — it’s free, no password.' },
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'error-callback'?: () => void }) => string;
      reset: (id?: string) => void;
    };
  }
}

// Enforce Turnstile only on the production deployment — a widget is domain-locked
// to the prod hostname, so on preview URLs it errors ("Unable to connect to
// website") and would hard-block sign-in. Mirrors turnstileActive() on the server.
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined;

/**
 * Passwordless buyer sign-in: "Continue with Google" (OAuth) + email magic link.
 * Mounted once globally; opened via the OPEN_BUYER_SIGNIN event. Turnstile renders
 * only when a site key is configured AND we're in production (server no-ops otherwise).
 */
export default function SignInModal() {
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [next, setNext] = React.useState('/account');
  const [reason, setReason] = React.useState<SignInReason>('account');
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tsToken, setTsToken] = React.useState<string | null>(null);
  const tsRef = React.useRef<HTMLDivElement>(null);
  const tsRendered = React.useRef(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { next?: string; reason?: SignInReason } | undefined;
      setNext(detail?.next || '/account');
      setReason(detail?.reason || 'account');
      setSent(false);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_BUYER_SIGNIN, onOpen);
    return () => window.removeEventListener(OPEN_BUYER_SIGNIN, onOpen);
  }, []);

  // Load + render Turnstile when the modal opens (if configured).
  React.useEffect(() => {
    if (!open || !TURNSTILE_SITE_KEY) return;
    const render = () => {
      if (tsRendered.current || !tsRef.current || !window.turnstile) return;
      tsRendered.current = true;
      window.turnstile.render(tsRef.current, {
        sitekey: TURNSTILE_SITE_KEY!,
        callback: (t) => setTsToken(t),
        'error-callback': () => setTsToken(null),
      });
    };
    if (window.turnstile) {
      render();
    } else if (!document.getElementById('cf-turnstile-script')) {
      const s = document.createElement('script');
      s.id = 'cf-turnstile-script';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          render();
        }
      }, 100);
      return () => clearInterval(t);
    }
  }, [open]);

  async function submitMagic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError('Enter your email.');
    if (TURNSTILE_SITE_KEY && !tsToken) return setError('Please complete the verification.');
    setSubmitting(true);
    try {
      const res = await fetch('/api/buyer/auth/magic/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), turnstileToken: tsToken, next, reason }),
      });
      if (!res.ok) throw new Error('failed');
      setSent(true);
    } catch {
      setError('Could not send the link. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  const googleHref = `/api/buyer/auth/google/start?next=${encodeURIComponent(next)}`;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-extrabold text-charcoal">{REASON_COPY[reason].title}</h2>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-2xl leading-none text-mute hover:text-charcoal">
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-mute">{REASON_COPY[reason].blurb}</p>

        {sent ? (
          <div className="mt-6 rounded-xl bg-success-bg p-5 text-center">
            <p className="text-lg font-bold text-success">Check your email</p>
            <p className="mt-1 text-sm text-charcoal">We sent a sign-in link to {email}.</p>
          </div>
        ) : (
          <>
            <a
              href={googleHref}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-pill border border-line bg-white px-5 py-3 text-sm font-bold text-charcoal hover:border-platinum-blue"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
              </svg>
              Continue with Google
            </a>

            <div className="my-4 flex items-center gap-3 text-xs text-mute-light">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={submitMagic} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full rounded-md border border-line px-3 py-2.5 text-sm"
                required
              />
              {TURNSTILE_SITE_KEY ? <div ref={tsRef} className="min-h-[65px]" /> : null}
              {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-pill bg-platinum-red px-5 py-3 text-sm font-bold text-white hover:bg-platinum-redHover disabled:opacity-60"
              >
                {submitting ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
