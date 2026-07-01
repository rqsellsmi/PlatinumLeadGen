'use client';

import * as React from 'react';
import Image from 'next/image';
import { Button, Input } from '@/components/ui';
import Logo from '@/components/Logo';
import { fireSellerGuideConversion } from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';
import type { Guide } from '@/drizzle/schema';

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
 * city so the lead routes by property proximity.
 */
export default function GuideDownloadBlock({ guide }: { guide: Guide }) {
  const bullets = parseBullets(guide.bulletsJson);
  const [firstName, setFirstName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/leads/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          firstName,
          email,
          leadType: 'seller_guide',
          locationSlug: '',
          ...getLeadAttribution(),
        }),
      });
      if (!res.ok) throw new Error('We could not process your request. Please try again.');
      const data = (await res.json().catch(() => ({}))) as { leadId?: number };
      if (data.leadId != null) fireSellerGuideConversion(data.leadId, email);
      setDone(true);
      window.open(guide.fileUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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

          {done ? (
            <p className="mt-6 flex items-center gap-2 font-bold text-success">
              ✓ Check your inbox — your guide is on the way.{' '}
              <a
                href={guide.fileUrl}
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download
              </a>
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-2.5">
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red"
                >
                  {error}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2.5">
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                  className="flex-1"
                />
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="Email address"
                  autoComplete="email"
                  className="flex-1"
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : (guide.ctaLabel ?? 'Email me the guide') + ' →'}
              </Button>
              <p className="text-xs text-mute-light">Free · We never share your information.</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
