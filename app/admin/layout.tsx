import Link from 'next/link';
import { signOut, auth } from '@/auth';
import Logo from '@/components/Logo';

/**
 * Admin shell — dark charcoal sidebar (Section 15.4). Presentational so the
 * login route (also wrapped) isn't blocked; page-level requireAdmin() and
 * middleware.ts enforce auth. The login page renders its own minimal chrome.
 */

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/leads', label: 'Leads' },
  { href: '/admin/round-robin', label: 'Round-Robin' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/offices', label: 'Offices' },
  { href: '/admin/locations', label: 'Locations' },
  { href: '/admin/testimonials', label: 'Testimonials' },
  { href: '/admin/recent-sales', label: 'Recent Sales' },
  { href: '/admin/data-upload', label: 'Data Upload' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/api-usage', label: 'API Usage' },
  { href: '/admin/email-log', label: 'Email Log' },
  { href: '/admin/api-keys', label: 'API Keys' },
  { href: '/admin/settings', label: 'Settings' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/admin/login' });
  }

  // Unauthenticated (login page): render children without the dashboard chrome.
  if (!session?.user) {
    return <div className="min-h-screen bg-offwhite">{children}</div>;
  }

  const name = session.user.name ?? 'Admin';
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-offwhite">
      <aside className="flex w-60 shrink-0 flex-col bg-charcoal text-white">
        <div className="px-5 py-5">
          <Logo variant="cream" width={150} />
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mute-lighter">
            Lead Console
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-sm font-semibold text-mute-lighter transition-colors hover:bg-charcoal-light hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-platinum-blue text-sm font-bold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{name}</p>
              <p className="text-xs text-mute-lighter">Brokerage Admin</p>
            </div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full rounded-pill border-[1.5px] border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-charcoal-light"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-8 py-3">
          <form
            action="/admin/leads"
            method="get"
            className="flex items-center gap-2 rounded-pill border border-line bg-offwhite px-4 py-2"
          >
            <span aria-hidden className="text-mute-lighter">
              🔍
            </span>
            <input
              name="q"
              placeholder="Search leads, addresses, emails…"
              aria-label="Search leads"
              className="w-48 bg-transparent text-sm text-charcoal outline-none placeholder:text-mute-lighter sm:w-72"
            />
          </form>
          <Link href="/admin/leads/new">
            <span className="inline-flex items-center rounded-pill bg-platinum-red px-4 py-2 text-sm font-bold text-white hover:bg-platinum-redHover">
              + Add lead
            </span>
          </Link>
        </header>
        <main className="flex-1 overflow-x-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
