'use client';

import * as React from 'react';
import Script from 'next/script';
import { Button, Input, Label, Card, CardBody, CardHeader } from '@/components/ui';
import { dataLayerPush } from '@/lib/clientAnalytics';
import { fireAppointmentRequestConversion } from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';
import { buildAppointmentBody } from '@/lib/leadRequests';
import { parsePlaceComponents } from '@/lib/placeComponents';
import PrivacyNote from '@/components/PrivacyNote';
import HoneypotField, { useFormLoadedAt, readHoneypot } from '@/components/HoneypotField';

interface PlaceData {
  propertyAddress: string;
  propertyLat: number | null;
  propertyLng: number | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
}

/**
 * Optional appointment-request form on the thank-you page (Section 22.7).
 *
 * Submitting is a lead SIGNAL, not a confirmed appointment (D4): it awards no
 * agent points and does not move the lead's stage. The bidding-quality
 * "Appointment" conversion fires when an AGENT sets appointment_set.
 *
 * With a report token the request attaches to that existing lead. WITHOUT one
 * (the form reached as a first touch) the endpoint reconciles by email and, if
 * new, CREATES a lead from these details — so the address field lets that lead
 * be routed. The token, when present, prefills the address; otherwise the
 * visitor picks it from Places autocomplete. The address is OPTIONAL: a
 * "call me" request is never blocked on it (a lead with no address routes to
 * the admin). See app/api/appointments/route.ts.
 */
export default function AppointmentForm({
  initialName = '',
  initialPhone = '',
  initialEmail = '',
  initialAddress = '',
  leadId = null,
  reportToken = null,
}: {
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  /** Prefilled property address when we already know the lead (token context). */
  initialAddress?: string;
  /** Used only for the client-side conversion transaction id, never sent as authorization. */
  leadId?: number | null;
  /** The capability that authorizes attaching this request to a lead. */
  reportToken?: string | null;
}) {
  const formLoadedAt = useFormLoadedAt();
  const formRef = React.useRef<HTMLFormElement>(null);
  const addressRef = React.useRef<HTMLInputElement>(null);
  const [idempotencyKey] = React.useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
  );
  const [name, setName] = React.useState(initialName);
  const [phone, setPhone] = React.useState(initialPhone);
  const [email, setEmail] = React.useState(initialEmail);
  const [preferredTime, setPreferredTime] = React.useState('');
  // Email is ALWAYS required. The browser can't tell a valid report token from
  // an expired/invalid one, so gating on "has token" would let a submit through
  // with no email only for the server to reject it. It is also the identity key
  // and the fallback contact channel. Valuation visitors have it prefilled.
  const emailRequired = true;
  const [address, setAddress] = React.useState(initialAddress);
  const [place, setPlace] = React.useState<PlaceData>({
    propertyAddress: initialAddress,
    propertyLat: null,
    propertyLng: null,
  });
  const [mapsReady, setMapsReady] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Prefill once values arrive from sessionStorage on the client.
  React.useEffect(() => {
    if (initialName) setName(initialName);
    if (initialPhone) setPhone(initialPhone);
    if (initialEmail) setEmail(initialEmail);
    if (initialAddress) {
      setAddress(initialAddress);
      setPlace((p) => ({ ...p, propertyAddress: initialAddress }));
    }
  }, [initialName, initialPhone, initialEmail, initialAddress]);

  const attach = React.useCallback((el: HTMLInputElement | null) => {
    const places = window.google?.maps?.places;
    if (!places || !el) return;
    const ac = new places.Autocomplete(el, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry', 'address_components'],
    });
    ac.addListener('place_changed', () => {
      const sel = ac.getPlace();
      const formatted = sel.formatted_address;
      const loc = sel.geometry?.location;
      if (!formatted) return;
      const parts = parsePlaceComponents(sel.address_components);
      setAddress(formatted);
      setPlace({
        propertyAddress: formatted,
        propertyLat: loc ? loc.lat() : null,
        propertyLng: loc ? loc.lng() : null,
        propertyCity: parts.city,
        propertyState: parts.state,
        propertyZip: parts.zip,
      });
    });
  }, []);

  // Attach autocomplete once Maps is ready (it may already be loaded by the
  // header's valuation widget, so check on mount as well as via Script onLoad).
  React.useEffect(() => {
    if (window.google?.maps?.places) {
      setMapsReady(true);
      attach(addressRef.current);
    }
  }, [attach]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (emailRequired && !email.trim()) {
      setError('Please enter your email so an agent can reach you.');
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
            email: email.trim() || undefined,
            preferredTime,
            // Optional — lets a tokenless appointment create a routable lead.
            propertyAddress: place.propertyAddress || address || undefined,
            propertyLat: place.propertyLat,
            propertyLng: place.propertyLng,
            propertyCity: place.propertyCity,
            propertyState: place.propertyState,
            propertyZip: place.propertyZip,
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
      fireAppointmentRequestConversion(leadId, email.trim() || initialEmail || undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      {mapsKey && !mapsReady ? (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
          strategy="afterInteractive"
          onLoad={() => {
            setMapsReady(true);
            attach(addressRef.current);
          }}
        />
      ) : null}
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
              <Label htmlFor="appt-email">Email{emailRequired ? '' : ' (optional)'}</Label>
              <Input
                id="appt-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required={emailRequired}
              />
            </div>
            <div>
              <Label htmlFor="appt-phone">Phone (optional)</Label>
              <Input
                id="appt-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div>
              <Label htmlFor="appt-address">Property address</Label>
              <Input
                id="appt-address"
                ref={addressRef}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setPlace((p) => ({ ...p, propertyAddress: e.target.value }));
                }}
                autoComplete="off"
                placeholder="Start typing your address (optional)"
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
            <PrivacyNote className="text-center" />
          </form>
        )}
      </CardBody>
    </Card>
  );
}
