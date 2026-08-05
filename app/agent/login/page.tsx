import { redirect } from 'next/navigation';
import { getCurrentAgent } from '@/lib/agentSession';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

/**
 * Agent sign-in.
 *
 * This is a Server Component purely so it can answer one question the client
 * form could not: is this person already signed in? The `/agent` layout renders
 * the portal shell whenever a session resolves, and it wraps this route too —
 * so an agent with a live cookie who landed here got the sidebar AND a login
 * form, and clicking any nav link took them straight in "without logging in".
 * That reads as a broken or insecure app; it was neither, but nobody should
 * have to work that out.
 *
 * An authenticated visitor is now sent where they were going instead.
 *
 * EXCEPT when a magic-link token is present. That token still has to be
 * consumed by the client flow: it may belong to a DIFFERENT agent (a forwarded
 * or shared device), and using it rotates it, which is what limits the useful
 * life of a link that got out. Redirecting past it would silently sign the
 * wrong person in and leave the token live.
 */
export default async function AgentLoginPage({
  searchParams,
}: {
  searchParams: { token?: string; next?: string };
}) {
  if (!searchParams.token) {
    const agent = await getCurrentAgent();
    if (agent) {
      // Same allowlist the client flow applies, so ?next= cannot be turned into
      // an open redirect on this path either.
      const next = searchParams.next ?? '';
      redirect(/^\/agent\/[\w\-/]*$/.test(next) ? next : '/agent/leads');
    }
  }
  return <LoginForm />;
}
