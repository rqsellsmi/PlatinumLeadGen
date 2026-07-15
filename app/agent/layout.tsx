import { redirect } from 'next/navigation';
import { getCurrentAgent, clearAgentSessionCookie } from '@/lib/agentSession';
import Logo from '@/components/Logo';
import AgentNav from '@/components/agent/AgentNav';
import MobileSidebar from '@/components/MobileSidebar';

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

  // Shared sidebar content — rendered in the desktop aside and the mobile drawer.
  const sidebar = (
    <>
      <div className="px-5 py-5">
        <Logo variant="cream" width={150} />
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mute-lighter">
          Agent Portal
        </p>
      </div>
      <AgentNav />
      <div className="space-y-4 px-4 py-4">
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
    </>
  );

  return (
    <div className="flex min-h-screen bg-offwhite">
      <aside className="hidden w-60 shrink-0 flex-col bg-charcoal text-white lg:flex">{sidebar}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-6 lg:px-8">
          {/* Mobile: hamburger + logo */}
          <div className="lg:hidden">
            <MobileSidebar label="Agent menu">{sidebar}</MobileSidebar>
          </div>
          <span className="lg:hidden">
            <Logo variant="blue" width={110} />
          </span>
          <form
            action="/agent/leads"
            method="get"
            className="hidden items-center gap-2 rounded-pill border border-line bg-offwhite px-4 py-2 md:flex"
          >
            <span aria-hidden className="text-mute-lighter">
              🔍
            </span>
            <input
              name="q"
              placeholder="Search my leads…"
              aria-label="Search my leads"
              className="w-40 bg-transparent text-sm text-charcoal outline-none placeholder:text-mute-lighter lg:w-56"
            />
          </form>
          <span
            className={`ml-auto inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm font-bold ${
              agent.isAvailable ? 'bg-success-bg text-success' : 'bg-line-hair text-mute'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${agent.isAvailable ? 'bg-success' : 'bg-mute-lighter'}`}
            />
            {agent.isAvailable ? 'Available' : 'Paused'}
          </span>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
