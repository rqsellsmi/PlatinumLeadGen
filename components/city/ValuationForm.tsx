'use client';

import * as React from 'react';
import Script from 'next/script';
import { Button, Input, Label, Select, Card, CardBody, CardHeader } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';

interface ValuationFormProps {
  locationSlug: string;
  cityName: string;
}

interface PlaceData {
  propertyAddress: string;
  propertyLat: number | null;
  propertyLng: number | null;
}

interface ValuationResult {
  estimatedValue: number;
  priceRangeLow: number;
  priceRangeHigh: number;
}

// Minimal typings for the Google Maps Places Autocomplete we use.
declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: Record<string, unknown>,
          ) => {
            addListener: (event: string, handler: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
            };
          };
        };
      };
    };
  }
}

const TIMEFRAMES = ['ASAP', '1-3 months', '3-6 months', 'Just researching'] as const;

/** Primary lead-capture, multi-step valuation form. */
export default function ValuationForm({ locationSlug, cityName }: ValuationFormProps) {
  const [sessionId] = React.useState(() => crypto.randomUUID());
  const [step, setStep] = React.useState<1 | 2>(1);

  const [place, setPlace] = React.useState<PlaceData>({
    propertyAddress: '',
    propertyLat: null,
    propertyLng: null,
  });
  const [valuation, setValuation] = React.useState<ValuationResult | null>(null);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [timeframe, setTimeframe] = React.useState<string>(TIMEFRAMES[0]);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const addressInputRef = React.useRef<HTMLInputElement>(null);
  const [mapsReady, setMapsReady] = React.useState(false);

  // Wire up Places Autocomplete once the Maps script has loaded.
  const initAutocomplete = React.useCallback(() => {
    const places = window.google?.maps?.places;
    if (!places || !addressInputRef.current) return;
    const autocomplete = new places.Autocomplete(addressInputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry'],
    });
    autocomplete.addListener('place_changed', () => {
      const selected = autocomplete.getPlace();
      const formatted = selected.formatted_address;
      const loc = selected.geometry?.location;
      if (!formatted) return;
      setPlace({
        propertyAddress: formatted,
        propertyLat: loc ? loc.lat() : null,
        propertyLng: loc ? loc.lng() : null,
      });
    });
    setMapsReady(true);
  }, []);

  React.useEffect(() => {
    if (window.google?.maps?.places) initAutocomplete();
  }, [initAutocomplete]);

  async function advanceToStep2(data: PlaceData) {
    setError(null);
    setLoading(true);
    try {
      // Best-effort partial capture; ignore failures (non-blocking).
      try {
        await fetch('/api/leads/partial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            propertyAddress: data.propertyAddress,
            propertyLat: data.propertyLat,
            propertyLng: data.propertyLng,
            locationSlug,
          }),
        });
      } catch {
        /* partial save is non-critical */
      }

      const res = await fetch('/api/valuation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: data.propertyAddress,
          propertyLat: data.propertyLat,
          propertyLng: data.propertyLng,
        }),
      });
      if (!res.ok) throw new Error('We could not estimate that address. Please try again.');
      const json = (await res.json()) as Partial<ValuationResult>;
      if (
        json.estimatedValue == null ||
        json.priceRangeLow == null ||
        json.priceRangeHigh == null
      ) {
        throw new Error('We could not estimate that address. Please try again.');
      }
      setValuation({
        estimatedValue: json.estimatedValue,
        priceRangeLow: json.priceRangeLow,
        priceRangeHigh: json.priceRangeHigh,
      });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    const address =
      place.propertyAddress.trim() || addressInputRef.current?.value.trim() || '';
    if (!address) {
      setError('Please enter your property address.');
      return;
    }
    void advanceToStep2({
      propertyAddress: address,
      propertyLat: place.propertyLat,
      propertyLng: place.propertyLng,
    });
  }

  async function handleStep2Submit(e: React.FormEvent) {
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
          sessionId,
          firstName,
          lastName,
          email,
          phone,
          timeframe,
          propertyAddress: place.propertyAddress,
          propertyLat: place.propertyLat,
          propertyLng: place.propertyLng,
          estimatedValue: valuation?.estimatedValue,
          priceRangeLow: valuation?.priceRangeLow,
          priceRangeHigh: valuation?.priceRangeHigh,
          locationSlug,
          leadType: 'valuation',
        }),
      });
      if (!res.ok) throw new Error('We could not submit your request. Please try again.');
      window.location.href = '/thank-you';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  return (
    <section id="valuation" className="bg-brand-light">
      <div className="mx-auto max-w-2xl px-4 py-16">
        {mapsKey ? (
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
            strategy="lazyOnload"
            onLoad={initAutocomplete}
          />
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-2xl font-bold text-brand-blue">
              What&apos;s Your {cityName} Home Worth?
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Get an instant, no-obligation estimate in seconds.
            </p>
          </CardHeader>
          <CardBody>
            {error ? (
              <div
                role="alert"
                className="mb-4 rounded-md border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red"
              >
                {error}
              </div>
            ) : null}

            {step === 1 ? (
              <form onSubmit={handleStep1Submit} className="space-y-4">
                <div>
                  <Label htmlFor="property-address">Property Address</Label>
                  <Input
                    id="property-address"
                    ref={addressInputRef}
                    type="text"
                    autoComplete="off"
                    placeholder="Start typing your address…"
                    defaultValue={place.propertyAddress}
                    onChange={(e) =>
                      setPlace((p) => ({ ...p, propertyAddress: e.target.value }))
                    }
                    required
                  />
                  {!mapsReady ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Type your full address and continue.
                    </p>
                  ) : null}
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Calculating…' : 'Get My Estimate'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleStep2Submit} className="space-y-4">
                {valuation ? (
                  <div className="rounded-lg border border-brand-blue/20 bg-white px-5 py-6 text-center">
                    <p className="text-sm font-medium text-slate-500">Estimated Value</p>
                    <p className="mt-1 text-4xl font-bold text-brand-blue">
                      {formatCurrency(valuation.estimatedValue)}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Range: {formatCurrency(valuation.priceRangeLow)} –{' '}
                      {formatCurrency(valuation.priceRangeHigh)}
                    </p>
                  </div>
                ) : null}

                <p className="text-sm text-slate-600">
                  Tell us where to send your full market report.
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>

                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </div>

                <div>
                  <Label htmlFor="timeframe">When are you looking to sell?</Label>
                  <Select
                    id="timeframe"
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                  >
                    {TIMEFRAMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Submitting…' : 'Get My Full Report'}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
