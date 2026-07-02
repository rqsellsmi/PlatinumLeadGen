'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

// Overview stays pinned at the top; everything else is grouped into collapsible
// sections so the sidebar reads as a short list instead of 16 flat links.
const OVERVIEW: NavItem = { href: '/admin', label: 'Overview' };
const GROUPS: NavGroup[] = [
  { label: 'Leads', items: [
    { href: '/admin/leads', label: 'Leads' },
    { href: '/admin/round-robin', label: 'Round-Robin' },
  ] },
  { label: 'Team', items: [
    { href: '/admin/agents', label: 'Agents' },
    { href: '/admin/offices', label: 'Offices' },
  ] },
  { label: 'Content', items: [
    { href: '/admin/locations', label: 'Locations' },
    { href: '/admin/testimonials', label: 'Testimonials' },
    { href: '/admin/recent-sales', label: 'Recent Sales' },
    { href: '/admin/downloads', label: 'Downloads' },
  ] },
  { label: 'Data & Insights', items: [
    { href: '/admin/data-upload', label: 'Data Upload' },
    { href: '/admin/analytics', label: 'Analytics' },
    { href: '/admin/api-usage', label: 'API Usage' },
    { href: '/admin/email-log', label: 'Email Log' },
  ] },
  { label: 'System', items: [
    { href: '/admin/api-keys', label: 'API Keys' },
    { href: '/admin/settings', label: 'Settings' },
    { href: '/admin/debug', label: 'Debug' },
  ] },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkClass = (active: boolean) =>
  `block rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    active ? 'bg-charcoal-light text-white' : 'text-mute-lighter hover:bg-charcoal-light hover:text-white'
  }`;

export default function AdminNav() {
  const pathname = usePathname() ?? '';
  // Track which groups are manually toggled; default-open follows the active route.
  const [openOverride, setOpenOverride] = React.useState<Record<string, boolean>>({});

  return (
    <nav className="flex-1 space-y-1 px-3 py-2">
      <Link href={OVERVIEW.href} className={linkClass(isActive(pathname, OVERVIEW.href))}>
        {OVERVIEW.label}
      </Link>

      {GROUPS.map((group) => {
        const hasActive = group.items.some((i) => isActive(pathname, i.href));
        const open = openOverride[group.label] ?? hasActive;
        return (
          <div key={group.label} className="pt-1">
            <button
              type="button"
              onClick={() =>
                setOpenOverride((s) => ({ ...s, [group.label]: !(s[group.label] ?? hasActive) }))
              }
              aria-expanded={open}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-mute-lighter/80 hover:text-white"
            >
              {group.label}
              <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>
                ›
              </span>
            </button>
            {open ? (
              <div className="mt-0.5 space-y-0.5">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href} className={linkClass(isActive(pathname, item.href))}>
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
