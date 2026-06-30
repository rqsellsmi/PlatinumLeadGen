import Image from 'next/image';
import type { Testimonial } from '@/drizzle/schema';
import { Badge } from '@/components/ui';

interface TestimonialsProps {
  testimonials: Testimonial[];
  cityName: string;
}

/** Client testimonials grid. Renders nothing when fewer than 2 are present. */
export default function Testimonials({ testimonials, cityName }: TestimonialsProps) {
  const active = testimonials.filter((t) => t.isActive);
  if (active.length < 2) return null;

  return (
    <section className="bg-brand-light">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold text-brand-blue">
          What {cityName} Homeowners Are Saying
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {active.map((t) => (
            <figure
              key={t.id}
              className="flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
            >
              <blockquote className="flex-1 text-slate-700">
                <p>&ldquo;{t.quote}&rdquo;</p>
              </blockquote>
              {t.saleDetails ? (
                <div className="mt-4">
                  <Badge>{t.saleDetails}</Badge>
                </div>
              ) : null}
              <figcaption className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
                {t.photoUrl ? (
                  <Image
                    src={t.photoUrl}
                    alt={t.clientName}
                    width={48}
                    height={48}
                    loading="lazy"
                    className="h-12 w-12 rounded-full object-cover"
                  />
                ) : null}
                <div>
                  <p className="font-semibold text-brand-blue">{t.clientName}</p>
                  {t.neighborhood ? (
                    <p className="text-sm text-slate-500">{t.neighborhood}</p>
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
