'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/agent/leads', label: 'My Leads' },
  { href: '/agent/pipeline', label: 'Pipeline' },
  { href: '/agent/performance', label: 'Performance' },
  { href: '/agent/leaderboard', label: 'Leaderboard' },
  { href: '/agent/settings', label: 'Settings' },
  { href: '/agent/help', label: 'Help' },
];

/** Agent portal sidebar nav with active-route highlighting. */
export default function AgentNav() {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 px-3 py-2">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'block rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              active ? 'bg-charcoal-light text-white' : 'text-mute-lighter hover:bg-charcoal-light hover:text-white',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
