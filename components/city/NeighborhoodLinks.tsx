import Link from 'next/link';
import type { NeighborhoodLink } from '@/drizzle/schema';

interface NeighborhoodLinksProps {
  links: NeighborhoodLink[];
  cityName: string;
}

/** Internal/long-tail neighborhood links. Renders nothing when empty. */
export default function NeighborhoodLinks({ links, cityName }: NeighborhoodLinksProps) {
  if (!links.length) return null;

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:py-20">
        <h2 className="text-2xl font-extrabold tracking-tight text-charcoal sm:text-3xl">
          Explore {cityName} Neighborhoods
        </h2>
        <ul className="mt-7 flex flex-wrap gap-2.5">
          {links.map((link) => (
            <li key={link.id}>
              <Link
                href={link.url}
                className="inline-flex rounded-pill bg-cream px-4 py-2.5 text-[15px] font-semibold text-platinum-blue transition-colors hover:bg-[#EDE9DC]"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
