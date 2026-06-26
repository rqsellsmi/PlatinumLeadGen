import { redirect } from 'next/navigation';
import { getCurrentAgent, clearAgentSessionCookie } from '@/lib/agentSession';
import { Button } from '@/components/ui';

/**
 * Agent portal layout (Section 9). Presentational top bar only — it does NOT
 * enforce auth (pages do that), so it never blocks the login route. We call
 * getCurrentAgent() purely to display the agent's name when signed in, and
 * render null-safely otherwise.
 */
export const dynamic = 'force-dynamic';

async function logoutAction() {
  'use server';
  await clearAgentSessionCookie();
  redirect('/agent/login');
}

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const agent = await getCurrentAgent();
  const agentName = agent ? [agent.firstName, agent.lastName].filter(Boolean).join(' ') : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center">
          <div className="text-sm font-bold text-brand-blue sm:text-base">
            RE/MAX Platinum <span className="font-normal text-slate-400">— Agent Portal</span>
          </div>
          {agent && (
            <div className="flex items-center gap-3">
              {agentName && <span className="text-sm text-slate-600">{agentName}</span>}
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Logout
                </Button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
