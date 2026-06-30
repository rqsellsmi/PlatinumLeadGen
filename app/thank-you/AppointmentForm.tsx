'use client';

import * as React from 'react';
import { Button, Input, Label, Card, CardBody, CardHeader } from '@/components/ui';

/** Optional appointment-request form on the thank-you page. */
export default function AppointmentForm() {
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [preferredTime, setPreferredTime] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

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
        <h2 className="text-xl font-bold text-brand-blue">Prefer to Schedule a Call?</h2>
        <p className="mt-1 text-sm text-slate-600">
          Let us know when you&apos;re available and an agent will reach out.
        </p>
      </CardHeader>
      <CardBody>
        {done ? (
          <p className="rounded-md border border-brand-blue/20 bg-brand-light px-4 py-3 text-sm text-brand-blue">
            Thanks! We&apos;ve received your request and an agent will be in touch shortly.
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
              <Label htmlFor="appt-name">Name</Label>
              <Input
                id="appt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
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
              <Label htmlFor="appt-time">Preferred Time</Label>
              <Input
                id="appt-time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                placeholder="e.g. Weekday afternoons"
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? 'Submitting…' : 'Request Appointment'}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
