'use client';

import * as React from 'react';
import { Button, Input, Label } from '@/components/ui';
import { fireSellerGuideConversion } from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';
import { buildGuideLeadBody } from '@/lib/leadRequests';
import HoneypotField, { useFormLoadedAt, readHoneypot } from '@/components/HoneypotField';

/**
 * Shared lead-capture form for the seller-guide download (P0.3).
 *
 * Both guide surfaces — the homepage `GuideDownloadBlock` and the city
 * `SellerGuideSection` — previously carried their own copy of this form and
 * submit logic, and BOTH omitted the honeypot + timing signals, so the abuse
 * gate was dormant on the guide funnel. Collapsing them into one component
 * removes the duplication and wires the signals once, in the single place the
 * request body is built. The surrounding marketing layout stays with each
 * caller; only the capture form lives here.
 */
export default function GuideCaptureForm({
  guideId = null,
  locationSlug,
  fileUrl,
  ctaLabel = 'Email me the guide →',
  loadingLabel = 'Sending…',
  inputLayout = 'stack',
  footer = null,
  className = '',
  doneClassName = 'flex items-center gap-2 py-2 text-base font-bold text-success',
}: {
  /** DB guide id (homepage block); omitted for the city banner. */
  guideId?: number | null;
  /** '' on the homepage (routes by proximity); the city slug on city pages. */
  locationSlug: string;
  /** Guide file opened on success and linked from the confirmation. */
  fileUrl: string;
  ctaLabel?: string;
  loadingLabel?: string;
  /** 'row' = inputs side by side (homepage); 'stack' = stacked (city banner). */
  inputLayout?: 'row' | 'stack';
  /** Optional content below the button (e.g. a privacy note). */
  footer?: React.ReactNode;
  /** className for the <form> element. */
  className?: string;
  /** className for the success message. */
  doneClassName?: string;
}) {
  const formLoadedAt = useFormLoadedAt();
  const formRef = React.useRef<HTMLFormElement>(null);
  const uid = React.useId();
  const firstNameId = `guide-first-${uid}`;
  const emailId = `guide-email-${uid}`;

  const [sessionId] = React.useState(() => crypto.randomUUID());
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
        body: JSON.stringify(
          buildGuideLeadBody({
            sessionId,
            firstName,
            email,
            locationSlug,
            guideId,
            honeypot: readHoneypot(formRef.current),
            formLoadedAt: formLoadedAt.current,
            attribution: getLeadAttribution(),
          }),
        ),
      });
      if (!res.ok) throw new Error('We could not process your request. Please try again.');
      const data = (await res.json().catch(() => ({}))) as { leadId?: number };
      // Fire the Seller Guide conversion after the confirmed save (§B.4).
      if (data.leadId != null) fireSellerGuideConversion(data.leadId, email);
      setDone(true);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className={doneClassName}>
        ✓ Check your inbox — your guide is on the way.{' '}
        <a href={fileUrl} className="font-semibold underline" target="_blank" rel="noopener noreferrer">
          Download
        </a>
      </p>
    );
  }

  const firstNameField = (
    <div className={inputLayout === 'row' ? 'flex-1' : undefined}>
      <Label htmlFor={firstNameId} className="sr-only">
        First name
      </Label>
      <Input
        id={firstNameId}
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        placeholder="First name"
        autoComplete="given-name"
        className={inputLayout === 'row' ? 'w-full' : undefined}
      />
    </div>
  );
  const emailField = (
    <div className={inputLayout === 'row' ? 'flex-1' : undefined}>
      <Label htmlFor={emailId} className="sr-only">
        Email
      </Label>
      <Input
        id={emailId}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        autoComplete="email"
        className={inputLayout === 'row' ? 'w-full' : undefined}
      />
    </div>
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className={`relative ${className}`.trim()}>
      <HoneypotField />
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red"
        >
          {error}
        </div>
      ) : null}
      {inputLayout === 'row' ? (
        <div className="flex flex-wrap gap-2.5">
          {firstNameField}
          {emailField}
        </div>
      ) : (
        <>
          {firstNameField}
          {emailField}
        </>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? loadingLabel : ctaLabel}
      </Button>
      {footer}
    </form>
  );
}
