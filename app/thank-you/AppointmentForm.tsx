'use client';

import * as React from 'react';
import { Button, Input, Label, Card, CardBody, CardHeader } from '@/components/ui';
import { dataLayerPush } from '@/lib/clientAnalytics';
import { fireAppointmentRequestConversion } from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';
import { buildAppointmentBody } from '@/lib/leadRequests';
import HoneypotField, { useFormLoadedAt, readHoneypot } from '@/components/HoneypotField';

/**
 * Optional appointment-request form on the thank-you page (Section 22.7).
 *
 * Submitting is a lead SIGNAL, not a confirmed appointment (D4): it awards no
 * agent points and does not move the lead's stage. The bidding-quality
 * "Appointment" conversion fires when an AGENT sets appointment_set.
 *
 * The request is authorized by the lead-bound report token, not by a leadId
 * (P0.3 / #10) — see app/api/appointments/route.ts.
 */
export default function AppointmentForm({
  initialName = '',
  initialPhone = '',
  initialEmail = '',
  leadId = null,
  reportToken = null,
}: {
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  /** Used only for the client-side conversion transaction id, never sent as authorization. */
  leadId?: number | null;
  /** The capability that authorizes attaching this request to a lead. */
  reportToken?: string | null;
}) {
  const formLoadedAt = useFormLoadedAt();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [idempotencyKey] = React.useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
  );
  const [name, setName] = React.useState(initialName);
  const [phone, setPhone] = React.useState(initialPhone);
  const [preferredTime, setPreferredTime] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // Prefill once values arrive from sessionStorage on the client.
  React.useEffect(() => {
    if (initialName) setName(initialName);
    if (initialPhone) setPhone(initialPhone);
  }, [initialName, initialPhone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildAppointmentBody({
            name,
            phone,
            email: initialEmail || undefined,
            preferredTime,
            // The capability, not a raw lead id — a public endpoint cannot trust
            // a bare integer to say which lead a request belongs to (P0.3).
            reportToken: reportToken ?? undefined,
            idempotencyKey,
            honeypot: readHoneypot(formRef.current),
            formLoadedAt: formLoadedAt.current,
            attribution: getLeadAttribution(),
          }),
        ),
      });
      if (!res.ok) throw new Error('We could not submit your request. Please try again.');
      dataLayerPush('appointment_requested');
      // Google Ads appointment conversion — fire after the confirmed save (§B.4 / §K.6).
      fireAppointmentRequestConversion(leadId, initialEmail || undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-bold text-charcoal">Prefer to schedule a call?</h2>
        <p className="mt-1 text-sm text-mute">
          Let us know when you&apos;re available and an agent will reach out.
        </p>
      </CardHeader>
      <CardBody>
        {done ? (
          <p className="rounded-lg border border-platinum-blue/20 bg-cream px-4 py-3 text-sm text-charcoal">
            Thanks! We&apos;ve received your request and an agent will be in touch shortly.
          </p>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit} className="relative space-y-4">
            <HoneypotField />
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red"
              >
                {error}
              </div>
            ) : null}
            <div>
              <Label htmlFor="appt-name">Name</Label>
              <Input id="appt-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </div>
            <div>
              <Label htmlFor="appt-phone">Phone</Label>
              <Input
                id="appt-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div>
              <Label htmlFor="appt-time">Preferred time</Label>
              <Input
                id="appt-time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                placeholder="e.g. Weekday afternoons"
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Submitting…' : 'Request appointment'}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
