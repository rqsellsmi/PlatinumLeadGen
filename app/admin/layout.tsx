import Link from 'next/link';
import { signOut, auth } from '@/auth';
import Logo from '@/components/Logo';
import AdminNav from '@/components/admin/AdminNav';
import MobileSidebar from '@/components/MobileSidebar';

/**
 * Admin shell — dark charcoal sidebar (Section 15.4). Presentational so the
 * login route (also wrapped) isn't blocked; page-level requireAdmin() and
 * middleware.ts enforce auth. The login page renders its own minimal chrome.
 * The nav itself lives in the AdminNav client component (collapsible groups).
 */

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

  // Shared sidebar content — rendered in the desktop aside and the mobile drawer.
  const sidebar = (
    <>
      <div className="px-5 py-5">
        <Logo variant="cream" width={150} />
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mute-lighter">
          Lead Console
        </p>
      </div>
      <AdminNav />
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
    </>
  );

  return (
    <div className="flex min-h-screen bg-offwhite">
      <aside className="hidden w-60 shrink-0 flex-col bg-charcoal text-white lg:flex">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-6 lg:px-8">
          {/* Mobile: hamburger + logo */}
          <div className="lg:hidden">
            <MobileSidebar label="Admin menu">{sidebar}</MobileSidebar>
          </div>
          <span className="lg:hidden">
            <Logo variant="blue" width={110} />
          </span>
          <form
            action="/admin/leads"
            method="get"
            className="hidden items-center gap-2 rounded-pill border border-line bg-offwhite px-4 py-2 md:flex"
          >
            <span aria-hidden className="text-mute-lighter">
              🔍
            </span>
            <input
              name="q"
              placeholder="Search leads, addresses, emails…"
              aria-label="Search leads"
              className="w-44 bg-transparent text-sm text-charcoal outline-none placeholder:text-mute-lighter lg:w-72"
            />
          </form>
          <Link href="/admin/leads/new" className="ml-auto">
            <span className="inline-flex items-center rounded-pill bg-platinum-red px-4 py-2 text-sm font-bold text-white hover:bg-platinum-redHover">
              + Add<span className="hidden sm:inline">&nbsp;lead</span>
            </span>
          </Link>
        </header>
        <main className="flex-1 overflow-x-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
