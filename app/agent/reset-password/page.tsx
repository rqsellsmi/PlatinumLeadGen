'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Input, Label, Card, CardBody } from '@/components/ui';

/**
 * Agent password reset page, reached from the emailed "Forgot password" link
 * (?token=...). Email-verified: only the inbox owner has the token. Sets a new
 * password via /api/agent/password/reset, then sends them to sign in.
 */
function ResetInner() {
  const token = (useSearchParams().get('token') ?? '').trim();
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
      const res = await fetch('/api/agent/password/reset', {
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
          ? 'This reset link is invalid or has expired. Request a new one from the sign-in page.'
          : data.error === 'weak_password'
            ? 'Choose a password of at least 8 characters.'
            : data.error === 'rate_limited'
              ? 'Too many attempts. Please wait a moment and try again.'
              : 'Could not reset your password. Please try again.',
      );
    } catch {
      setError('Could not reset your password. Please try again.');
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
            <p className="text-sm text-slate-500">Choose a new password</p>
          </div>

          {done ? (
            <div className="space-y-4">
              <p className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand-blue">
                Your password has been reset. You can now sign in.
              </p>
              <Link href="/agent/login">
                <Button className="w-full">Go to sign in</Button>
              </Link>
            </div>
          ) : !token ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">
              This reset link is missing its token. Request a new one from the sign-in page.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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
                {pending ? 'Saving…' : 'Set new password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
