'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/auth';

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!username || !password) {
    return { error: 'Username and password are required.' };
  }

  try {
    await signIn('credentials', {
      username,
      password,
      redirectTo: '/admin',
    });
    return {};
  } catch (err) {
    // signIn throws a redirect on success — let Next handle it.
    if (err instanceof AuthError) {
      return { error: 'Invalid username or password.' };
    }
    throw err;
  }
}
