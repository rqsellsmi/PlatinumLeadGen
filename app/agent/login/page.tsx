'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, Label, Card, CardBody } from '@/components/ui';

const MAGIC_SUCCESS = 'If that email matches an agent, a login link is on its way.';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Magic link request form
  const [magicEmail, setMagicEmail] = useState('');
  const [magicMessage, setMagicMessage] = useState<string | null>(null);
  const [magicPending, setMagicPending] = useState(false);

  // Email + password form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwPending, setPwPending] = useState(false);

  // Token (magic link) auto-login
  const token = searchParams.get('token');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenPending, setTokenPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setTokenPending(true);
    setTokenError(null);
    (async () => {
      try {
        const res = await fetch('/api/agent/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (res.ok) {
          router.push('/agent/leads');
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setTokenError(
          data.error === 'inactive'
            ? 'Your agent account is inactive. Ask your broker to activate it, then open the link again.'
            : 'This login link is invalid or expired. Request a new one below.',
        );
      } catch {
        if (!cancelled) setTokenError('This login link is invalid or expired. Request a new one below.');
      } finally {
        if (!cancelled) setTokenPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  async function handleMagicSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMagicPending(true);
    setMagicMessage(null);
    try {
      await fetch('/api/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicEmail, requestLink: true }),
      });
    } catch {
      // Swallow — we always show the same neutral message to avoid enumeration.
    } finally {
      setMagicMessage(MAGIC_SUCCESS);
      setMagicPending(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwPending(true);
    setPwError(null);
    try {
      const res = await fetch('/api/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push('/agent/leads');
        return;
      }
      setPwError('Invalid email or password.');
    } catch {
      setPwError('Invalid email or password.');
    } finally {
      setPwPending(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-brand-blue">RE/MAX Platinum</h1>
            <p className="text-sm text-slate-500">Agent sign in</p>
          </div>

          {tokenPending && (
            <p className="mb-4 rounded-md bg-brand-light px-3 py-2 text-sm text-brand-blue">
              Signing you in…
            </p>
          )}
          {tokenError && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{tokenError}</p>
          )}

          {/* Email + password */}
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {pwError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{pwError}</p>
            )}
            <Button type="submit" className="w-full" disabled={pwPending}>
              {pwPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs uppercase tracking-wide text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Magic link request */}
          <form onSubmit={handleMagicSubmit} className="space-y-3">
            <div>
              <Label htmlFor="magic-email">Email me a magic link</Label>
              <Input
                id="magic-email"
                name="magic-email"
                type="email"
                autoComplete="email"
                required
                value={magicEmail}
                placeholder="you@example.com"
                onChange={(e) => setMagicEmail(e.target.value)}
              />
            </div>
            {magicMessage && (
              <p className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand-blue">
                {magicMessage}
              </p>
            )}
            <Button type="submit" variant="secondary" className="w-full" disabled={magicPending}>
              {magicPending ? 'Sending…' : 'Send login link'}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

export default function AgentLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
