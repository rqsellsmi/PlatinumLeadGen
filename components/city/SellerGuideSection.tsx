'use client';

import * as React from 'react';
import { Button, Input, Label, Card, CardBody, CardHeader } from '@/components/ui';
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
    <section className="bg-white">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardHeader>
            <h2 className="text-2xl font-bold text-brand-blue">Free Home Seller&apos;s Guide</h2>
            <p className="mt-1 text-sm text-slate-600">
              Everything you need to know to sell for top dollar. Get your copy instantly.
            </p>
          </CardHeader>
          <CardBody>
            {done ? (
              <p className="rounded-md border border-brand-blue/20 bg-brand-light px-4 py-3 text-sm text-brand-blue">
                Your guide is on its way! If the download didn&apos;t start,{' '}
                <a href={guideUrl} className="font-semibold underline" target="_blank" rel="noopener noreferrer">
                  click here
                </a>
                .
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error ? (
                  <div
                    role="alert"
                    className="rounded-md border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red"
                  >
                    {error}
                  </div>
                ) : null}
                <div>
                  <Label htmlFor="guide-firstName">First Name</Label>
                  <Input
                    id="guide-firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <Label htmlFor="guide-email">Email *</Label>
                  <Input
                    id="guide-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Preparing…' : 'Download Guide'}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
