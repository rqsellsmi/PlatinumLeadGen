'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardBody } from '@/components/ui';
import { dataLayerPush } from '@/lib/clientAnalytics';
import AppointmentForm from './AppointmentForm';

const STEPS = [
  'A local RE/MAX Platinum expert reviews your home and recent comparable sales.',
  'They prepare your personalized market report and recommended listing price.',
  'You get a call to walk through the numbers — no obligation.',
];

/** Within the 7am–8pm ET offer window? (Section 22.7 dynamic response time) */
function withinOfferWindow(): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
  return hour >= 7 && hour < 20;
}

export default function ThankYouClient() {
  const params = useSearchParams();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [responseMsg, setResponseMsg] = React.useState('within 3 hours');

  React.useEffect(() => {
    const type = params.get('type') ?? 'valuation';
    const city = params.get('city') ?? '';
    const variant = params.get('variant') ?? 'seo';
    const email = sessionStorage.getItem('lead_email') ?? '';
    const ph = sessionStorage.getItem('lead_phone') ?? '';
    setName(sessionStorage.getItem('lead_name') ?? '');
    setPhone(ph);
    setResponseMsg(withinOfferWindow() ? 'within 3 hours' : 'first thing tomorrow morning');

    // PRIMARY conversion event (Section 21.3).
    dataLayerPush('lead_conversion', {
      lead_type: type,
      city,
      page_variant: variant,
      value: 50,
      email,
      phone: ph,
    });
  }, [params]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success text-3xl text-white">
          ✓
        </div>
        <h1 className="mt-6 text-3xl font-bold text-charcoal">Thank you!</h1>
        <p className="mt-4 text-lg text-mute">
          We&apos;ve received your request. A local RE/MAX Platinum expert is reviewing your
          information now.
        </p>
        <p className="mt-4 rounded-lg border border-line bg-cream px-4 py-3 text-sm text-mute">
          <span className="font-semibold text-charcoal">Expected response time:</span> {responseMsg}.
        </p>
      </div>

      <div className="mt-12">
        <h2 className="text-center text-xl font-bold text-charcoal">What happens next</h2>
        <ol className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={i} className="rounded-card border border-line bg-white p-5 text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-charcoal font-numeric text-sm font-bold text-white">
                {i + 1}
              </div>
              <p className="mt-3 text-sm text-mute">{s}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-12">
        <AppointmentForm initialName={name} initialPhone={phone} />
      </div>

      <div className="mt-10">
        <Card>
          <CardBody className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-bold text-charcoal">Know a neighbor thinking of selling?</p>
              <p className="text-sm text-mute">Share this free home value tool.</p>
            </div>
            <Button variant="secondary" onClick={copyLink}>
              {copied ? 'Link copied!' : 'Copy link'}
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
