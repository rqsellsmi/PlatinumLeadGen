import Link from 'next/link';
import Logo from '@/components/Logo';

/** Shared public site footer (Section 15). */
export default function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line bg-cream">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-mute sm:flex-row">
        <Logo variant="blue" width={130} />
        <nav className="flex items-center gap-6 font-semibold text-charcoal">
          <Link href="/" className="hover:text-platinum-blue">
            Home
          </Link>
          <Link href="/sell" className="hover:text-platinum-blue">
            Michigan Cities
          </Link>
        </nav>
        <div className="text-mute-light">
          &copy; {new Date().getFullYear()} RE/MAX Platinum. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
