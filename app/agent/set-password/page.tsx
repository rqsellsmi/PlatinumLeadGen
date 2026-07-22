'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Label, Card, CardBody } from '@/components/ui';

/**
 * Public agent password setup / reset page. One shared URL — the agent enters
 * the brokerage setup code + their (rostered) email + a new password. Serves
 * both first-time setup and self-service reset. Gated server-side by the setup
 * code and a matching agent email (see /api/agent/set-password).
 */
export default function SetPasswordPage() {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
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
        body: JSON.stringify({ code: code.trim(), email: email.trim(), password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === 'invalid_code'
          ? 'That setup code is not correct. Check with your broker.'
          : data.error === 'email_not_found'
            ? 'That email is not on our agent roster. Ask your broker to add you, then try again.'
            : data.error === 'weak_password'
              ? 'Choose a password of at least 8 characters.'
              : data.error === 'setup_closed'
                ? 'Password setup is not enabled yet. Ask your broker to set the agent setup code.'
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
            <p className="text-sm text-slate-500">Set up your agent password</p>
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
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-slate-500">
                Enter the setup code from your broker and the email address on file for you, then
                choose a password. Use this same page any time you need to reset your password.
              </p>
              <div>
                <Label htmlFor="code">Setup code</Label>
                <Input id="code" name="code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
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
