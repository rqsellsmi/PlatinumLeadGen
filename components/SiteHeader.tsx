import Link from 'next/link';
import Logo from '@/components/Logo';

/** Shared public site header (Section 15). */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <Logo variant="blue" width={140} priority />
        <nav className="flex items-center gap-7 text-sm font-semibold text-charcoal">
          <Link href="/" className="hidden hover:text-platinum-blue sm:inline">
            Home
          </Link>
          <Link href="/sell" className="hidden hover:text-platinum-blue sm:inline">
            Cities
          </Link>
          <Link
            href="/sell"
            className="rounded-pill bg-platinum-red px-5 py-2 text-white hover:bg-platinum-redHover"
          >
            Free Home Value
          </Link>
        </nav>
      </div>
    </header>
  );
}
