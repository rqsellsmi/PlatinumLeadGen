'use client';

import * as React from 'react';
import { Button, Input, Label, Card, CardBody, CardHeader } from '@/components/ui';
import { dataLayerPush } from '@/lib/clientAnalytics';

/** Optional appointment-request form on the thank-you page (Section 22.7). */
export default function AppointmentForm({
  initialName = '',
  initialPhone = '',
}: {
  initialName?: string;
  initialPhone?: string;
}) {
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
        body: JSON.stringify({ name, phone, preferredTime }),
      });
      if (!res.ok) throw new Error('We could not submit your request. Please try again.');
      dataLayerPush('appointment_requested');
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
          <form onSubmit={handleSubmit} className="space-y-4">
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
