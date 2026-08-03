'use client';

import Image from 'next/image';
import Logo from '@/components/Logo';
import type { Guide } from '@/drizzle/schema';
import PrivacyNote from '@/components/PrivacyNote';
import GuideCaptureForm from '@/components/GuideCaptureForm';

function parseBullets(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Admin-managed guide download with inline lead capture. Reuses the
 * seller_guide lead flow (leadType 'seller_guide'); the homepage passes no
 * city so the lead routes by property proximity. The capture form itself lives
 * in the shared GuideCaptureForm (P0.3), which carries the abuse signals.
 */
export default function GuideDownloadBlock({ guide }: { guide: Guide }) {
  const bullets = parseBullets(guide.bulletsJson);

  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:py-24 lg:grid-cols-2">
        {/* Cover */}
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-charcoal p-8">
          {guide.coverImageUrl ? (
            <Image
              src={guide.coverImageUrl}
              alt={guide.coverTitle ?? guide.title}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          ) : (
            <div className="relative z-10 text-center">
              {guide.pagesLabel ? (
                <p className="mb-4 text-[12px] font-bold uppercase tracking-[0.14em] text-platinum-red">
                  Free · {guide.pagesLabel}
                </p>
              ) : null}
              <p className="font-serif text-3xl font-medium leading-tight text-white">
                {guide.coverTitle ?? guide.title}
              </p>
              <div className="mt-8 flex justify-center opacity-90">
                <Logo variant="cream" width={150} href={null} />
              </div>
            </div>
          )}
        </div>

        {/* Content + form */}
        <div>
          <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
            Free download
          </p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-charcoal sm:text-4xl">
            {guide.title}
          </h2>
          {guide.subtitle ? (
            <p className="mt-3 leading-relaxed text-mute">{guide.subtitle}</p>
          ) : null}

          {bullets.length > 0 ? (
            <ul className="mt-6 space-y-2.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm font-semibold text-charcoal">
                  <span className="mt-0.5 text-success" aria-hidden>
                    ✓
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          ) : null}

          <GuideCaptureForm
            guideId={guide.id}
            locationSlug=""
            fileUrl={guide.fileUrl}
            ctaLabel={(guide.ctaLabel ?? 'Email me the guide') + ' →'}
            inputLayout="row"
            className="mt-6 max-w-md space-y-2.5"
            doneClassName="mt-6 flex items-center gap-2 font-bold text-success"
            footer={
              <>
                <p className="text-xs text-mute-light">Free.</p>
                <PrivacyNote />
              </>
            }
          />
        </div>
      </div>
    </section>
  );
}
