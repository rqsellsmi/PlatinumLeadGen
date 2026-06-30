import Link from 'next/link';

/** Minimal shared public footer. */
export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-brand-light">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-600 sm:flex-row">
        <div className="font-bold text-brand-blue">
          RE/MAX <span className="text-brand-red">Platinum</span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/" className="hover:text-brand-blue">
            Home
          </Link>
          <Link href="/sell" className="hover:text-brand-blue">
            Michigan Cities
          </Link>
        </nav>
        <div className="text-slate-500">
          &copy; {new Date().getFullYear()} RE/MAX Platinum. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
