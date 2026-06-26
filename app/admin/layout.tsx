import Link from 'next/link';
import { signOut } from '@/auth';
import { Button } from '@/components/ui';

/**
 * Admin shell — sidebar nav + sign-out. Purely presentational so the login
 * route (which it also wraps) is not blocked. Page-level requireAdmin() and
 * middleware.ts enforce auth.
 */

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/leads', label: 'Leads' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/offices', label: 'Offices' },
  { href: '/admin/locations', label: 'Locations' },
  { href: '/admin/api-keys', label: 'API Keys' },
  { href: '/admin/settings', label: 'Settings' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/admin/login' });
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <Link href="/admin" className="text-lg font-bold text-brand-blue">
            RE/MAX Platinum
          </Link>
          <p className="text-xs text-slate-500">Admin</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light hover:text-brand-blue"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-3 py-4">
          <form action={signOutAction}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto px-8 py-8">{children}</main>
    </div>
  );
}
