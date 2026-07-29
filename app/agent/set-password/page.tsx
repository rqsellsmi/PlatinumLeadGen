'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Input, Label, Card, CardBody } from '@/components/ui';

/**
 * First-time account setup, reached from a per-agent invite email (D7).
 *
 * The page used to ask for a shared brokerage setup code plus the agent's
 * email. That combination proved nothing about who was using it — a shared
 * secret circulates, and knowing a roster email is not control of it. The
 * invite token in the URL is unique to one agent, single-use and expiring, so
 * arriving here at all is the proof.
 *
 * There is deliberately no way to reach this page without a token: an agent who
 * needs a link asks the office, and an agent who already has a password uses
 * "Forgot your password?" on the sign-in page.
 */
export default function SetPasswordPage() {
  const params = useSearchParams();
  const token = (params.get('token') ?? '').trim();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/agent/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === 'invalid_token'
          ? 'This invitation link is no longer valid — it may have expired or already been used. Ask the office to send a new one.'
          : data.error === 'inactive'
            ? 'This account is not active. Please contact the office.'
            : data.error === 'already_set'
              ? 'You already have a password. Use “Forgot your password?” on the sign-in page to reset it.'
              : data.error === 'weak_password'
                ? 'Choose a password of at least 8 characters.'
                : data.error === 'rate_limited'
                  ? 'Too many attempts. Please wait a moment and try again.'
                  : 'Could not set your password. Please try again.',
      );
    } catch {
      setError('Could not set your password. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-brand-blue">RE/MAX Platinum</h1>
            <p className="text-sm text-slate-500">Set up your account</p>
          </div>

          {done ? (
            <div className="space-y-4">
              <p className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand-blue">
                Your password is set. You can now sign in.
              </p>
              <Link href="/agent/login">
                <Button className="w-full">Go to sign in</Button>
              </Link>
            </div>
          ) : !token ? (
            <div className="space-y-4">
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">
                This page needs the invitation link the office emailed you. Open that link, or ask
                the office to send a new invitation.
              </p>
              <p className="text-center text-sm">
                <Link href="/agent/login" className="font-semibold text-brand-blue hover:underline">
                  Back to sign in
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-slate-500">
                Choose a password for your agent portal. Already have one? Use{' '}
                <Link href="/agent/login" className="font-semibold text-brand-blue hover:underline">
                  Forgot your password
                </Link>{' '}
                on the sign-in page instead.
              </p>
              <div>
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Saving…' : 'Set password'}
              </Button>
              <p className="text-center text-sm">
                <Link href="/agent/login" className="font-semibold text-brand-blue hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
