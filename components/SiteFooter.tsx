import Link from 'next/link';
import Logo from '@/components/Logo';
import { getFooterOffice } from '@/lib/queries';
import { BROKER_OFFICE_OF_RECORD, telHref as buildTelHref } from '@/lib/officeFallback';

// Launch communities shown in the footer. Update if the active-city set changes.
const COMMUNITIES = [
  { name: 'Brighton', slug: 'brighton-mi' },
  { name: 'Ann Arbor', slug: 'ann-arbor-mi' },
  { name: 'Fenton', slug: 'fenton-mi' },
  { name: 'Grand Blanc', slug: 'grand-blanc-mi' },
];

// Fallback when the offices table is empty or unreachable. This used to be a
// FABRICATED address and a 555 phone number, rendered as a live tel: link on
// any DB error — see lib/officeFallback.ts. It is now the real office of
// record, so a degraded render is still truthful and still dialable.

/**
 * Shared public site footer — dark, multi-column (Section 15). The Contact
 * address reflects the office for the page context (linked office → closest
 * office by coordinates → Brighton). Pass `locationId` on a city page and/or
 * `latitude`/`longitude`; pass nothing (main page, legal, etc.) to default to
 * Brighton.
 */
export default async function SiteFooter({
  locationId,
  latitude,
  longitude,
}: {
  locationId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
} = {}) {
  const year = new Date().getFullYear();
  const office =
    (await getFooterOffice({ locationId, latitude, longitude })) ?? BROKER_OFFICE_OF_RECORD;
  const telHref = buildTelHref(office.phone);
  const cityStateZip = [office.city ? `${office.city},` : null, office.state, office.zip]
    .filter(Boolean)
    .join(' ');
  return (
    <footer className="bg-charcoal">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo variant="cream" width={150} />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mute-lighter">
              Serving Brighton, Ann Arbor, Fenton, Grand Blanc, and surrounding areas. Each office
              independently owned and operated.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute-lighter">
              Explore
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/" className="text-white/85 hover:text-white">
                  Home values
                </Link>
              </li>
              <li>
                <Link href="/sell" className="text-white/85 hover:text-white">
                  Michigan cities
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-white/85 hover:text-white">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-white/85 hover:text-white">
                  Terms
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute-lighter">
              Communities
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {COMMUNITIES.map((c) => (
                <li key={c.slug}>
                  <Link href={`/sell/${c.slug}`} className="text-white/85 hover:text-white">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute-lighter">
              Contact
            </p>
            <address className="mt-3 not-italic text-sm leading-relaxed text-white/85">
              {office.name}
              {office.address ? (
                <>
                  <br />
                  {office.address}
                </>
              ) : null}
              {cityStateZip ? (
                <>
                  <br />
                  {cityStateZip}
                </>
              ) : null}
              {telHref ? (
                <>
                  <br />
                  <a href={telHref} className="text-[#A3D4F2] hover:underline">
                    {office.phone}
                  </a>
                </>
              ) : null}
            </address>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs text-mute-lighter">
          <span>&copy; {year} RE/MAX Platinum. All rights reserved. Equal Housing Opportunity.</span>
          <span>Privacy · Terms · Accessibility</span>
        </div>
      </div>
    </footer>
  );
}
