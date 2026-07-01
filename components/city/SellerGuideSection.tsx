'use client';

import * as React from 'react';
import { Button, Input, Label } from '@/components/ui';
import { fireSellerGuideConversion } from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';

interface SellerGuideSectionProps {
  locationSlug: string;
  guideUrl: string | null;
}

/** Gated seller-guide download with inline lead capture. */
export default function SellerGuideSection({ locationSlug, guideUrl }: SellerGuideSectionProps) {
  // Caller also guards, but defend here per spec.
  if (!guideUrl) return null;

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
          locationSlug,
          ...getLeadAttribution(),
        }),
      });
      if (!res.ok) throw new Error('We could not process your request. Please try again.');
      const data = (await res.json().catch(() => ({}))) as { leadId?: number };
      // Fire the Seller Guide conversion after the confirmed save (§B.4).
      if (data.leadId != null) fireSellerGuideConversion(data.leadId, email);
      setDone(true);
      if (guideUrl) window.open(guideUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-platinum-blue">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8 px-4 py-14 sm:py-20">
        <div className="flex-1 basis-80">
          <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-[#A3D4F2]">
            Free download
          </p>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            The Home Seller&apos;s Guide
          </h2>
          <p className="mt-2.5 leading-relaxed text-white/90">
            Pricing, prep, and timing strategies for selling in today&apos;s market — free PDF.
          </p>
        </div>
        <div className="flex-1 basis-80 rounded-2xl bg-white p-5">
          {done ? (
            <p className="flex items-center gap-2 py-2 text-base font-bold text-success">
              ✓ Check your inbox — your guide is on the way.
              <a href={guideUrl} className="font-semibold underline" target="_blank" rel="noopener noreferrer">
                Download
              </a>
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red"
                >
                  {error}
                </div>
              ) : null}
              <Label htmlFor="guide-firstName" className="sr-only">
                First name
              </Label>
              <Input
                id="guide-firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                autoComplete="given-name"
              />
              <Label htmlFor="guide-email" className="sr-only">
                Email
              </Label>
              <Input
                id="guide-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
              />
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? 'Preparing…' : 'Download the guide →'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
