'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

/**
 * Mobile hamburger + slide-in drawer for the admin/agent shells. Renders the
 * same charcoal sidebar content passed as children. Closes on route change,
 * backdrop click, or Escape; locks body scroll while open. Hidden on desktop
 * by the caller (the drawer only mounts on small screens).
 */
export default function MobileSidebar({
  children,
  label = 'Menu',
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close when navigating to a new route.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-charcoal hover:bg-offwhite"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 animate-fadeIn bg-[rgba(20,20,24,0.55)]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col bg-charcoal text-white shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-mute-lighter hover:bg-charcoal-light hover:text-white"
            >
              ×
            </button>
            <div className="flex h-full flex-col overflow-y-auto">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
