'use client';

import * as React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Input, Label, Card, CardBody } from '@/components/ui';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export default function AdminLoginPage() {
  const [state, formAction] = useFormState(loginAction, initialState);
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-platinum-blue">RE/MAX Platinum</h1>
            <p className="text-sm text-mute-light">Admin sign in</p>
          </div>
          <form action={formAction} className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" type="text" autoComplete="username" required />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-xs font-semibold text-platinum-blue hover:underline"
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
              />
            </div>
            {state.error && (
              <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-platinum-red">{state.error}</p>
            )}
            <SubmitButton />
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
