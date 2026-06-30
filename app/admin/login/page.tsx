'use client';

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

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-brand-blue">RE/MAX Platinum</h1>
            <p className="text-sm text-slate-500">Admin sign in</p>
          </div>
          <form action={formAction} className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" type="text" autoComplete="username" required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {state.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{state.error}</p>
            )}
            <SubmitButton />
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
