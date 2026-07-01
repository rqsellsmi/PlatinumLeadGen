import { redirect } from 'next/navigation';
import { getCurrentAgent, clearAgentSessionCookie } from '@/lib/agentSession';
import Logo from '@/components/Logo';
import AvailabilityToggle from '@/components/agent/AvailabilityToggle';
import AgentNav from '@/components/agent/AgentNav';

/**
 * Agent portal shell (Section 15.4 / 16.4). Dark charcoal sidebar with the
 * availability toggle panel above the user identity, plus a header pill that
 * surfaces availability on every page. Presentational — pages enforce auth, so
 * the login route renders without the sidebar.
 */
export const dynamic = 'force-dynamic';

async function logoutAction() {
  'use server';
  await clearAgentSessionCookie();
  redirect('/agent/login');
}

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const agent = await getCurrentAgent();

  if (!agent) {
    return <div className="min-h-screen bg-offwhite">{children}</div>;
  }

  const agentName = [agent.firstName, agent.lastName].filter(Boolean).join(' ');
  const initials = agentName.slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-offwhite">
      <aside className="flex w-60 shrink-0 flex-col bg-charcoal text-white">
        <div className="px-5 py-5">
          <Logo variant="cream" width={150} />
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mute-lighter">
            Agent Portal
          </p>
        </div>
        <AgentNav />
        <div className="space-y-4 px-4 py-4">
          <AvailabilityToggle initial={agent.isAvailable} />
          <div className="flex items-center gap-3 border-t border-white/10 pt-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-platinum-blue text-sm font-bold text-white">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{agentName}</p>
              <form action={logoutAction}>
                <button type="submit" className="text-xs text-mute-lighter hover:text-white">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-8 py-3.5">
          <form
            action="/agent/leads"
            method="get"
            className="flex items-center gap-2 rounded-pill border border-line bg-offwhite px-4 py-2"
          >
            <span aria-hidden className="text-mute-lighter">
              🔍
            </span>
            <input
              name="q"
              placeholder="Search my leads…"
              aria-label="Search my leads"
              className="w-40 bg-transparent text-sm text-charcoal outline-none placeholder:text-mute-lighter sm:w-56"
            />
          </form>
          <span
            className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm font-bold ${
              agent.isAvailable ? 'bg-success-bg text-success' : 'bg-line-hair text-mute'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${agent.isAvailable ? 'bg-success' : 'bg-mute-lighter'}`}
            />
            {agent.isAvailable ? 'Available' : 'Paused'}
          </span>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
