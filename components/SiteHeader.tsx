import Link from 'next/link';

/** Minimal shared public header. */
export default function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight text-brand-blue">
          RE/MAX <span className="text-brand-red">Platinum</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-700">
          <Link href="/" className="hover:text-brand-blue">
            Home
          </Link>
          <Link href="/sell" className="hover:text-brand-blue">
            Cities
          </Link>
        </nav>
      </div>
    </header>
  );
}
