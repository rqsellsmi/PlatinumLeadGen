import Image from 'next/image';
import type { Testimonial } from '@/drizzle/schema';

interface TestimonialsProps {
  testimonials: Testimonial[];
  cityName: string;
}

/** Client testimonials grid. Renders nothing when fewer than 2 are present. */
export default function Testimonials({ testimonials, cityName }: TestimonialsProps) {
  const active = testimonials.filter((t) => t.isActive);
  if (active.length < 2) return null;

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <h2 className="text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
          What {cityName} Homeowners Are Saying
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {active.map((t) => (
            <figure key={t.id} className="flex flex-col rounded-xl bg-cream p-9">
              <div className="mb-4 flex gap-0.5 text-platinum-red" aria-hidden>
                {'★★★★★'.split('').map((s, i) => (
                  <span key={i}>{s}</span>
                ))}
              </div>
              <blockquote className="flex-1">
                <p className="font-serif text-xl leading-relaxed text-charcoal">
                  &ldquo;{t.quote}&rdquo;
                </p>
              </blockquote>
              {t.saleDetails ? (
                <div className="mt-5">
                  <span className="inline-block rounded-pill border border-line bg-white px-3 py-1.5 text-xs font-bold text-success">
                    {t.saleDetails}
                  </span>
                </div>
              ) : null}
              <figcaption className="mt-4 flex items-center gap-3">
                {t.photoUrl ? (
                  <Image
                    src={t.photoUrl}
                    alt={t.clientName}
                    width={44}
                    height={44}
                    loading="lazy"
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : null}
                <div>
                  <p className="font-bold text-charcoal">{t.clientName}</p>
                  {t.neighborhood ? (
                    <p className="text-sm text-mute-light">{t.neighborhood}</p>
                  ) : null}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
