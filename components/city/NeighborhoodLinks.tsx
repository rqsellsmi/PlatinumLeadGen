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
    <section className="bg-brand-light">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold text-brand-blue">
          Explore {cityName} Neighborhoods
        </h2>
        <ul className="mx-auto mt-8 flex max-w-4xl flex-wrap justify-center gap-3">
          {links.map((link) => (
            <li key={link.id}>
              <Link
                href={link.url}
                className="inline-flex rounded-full border border-brand-blue/30 bg-white px-4 py-2 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-blue hover:text-white"
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
