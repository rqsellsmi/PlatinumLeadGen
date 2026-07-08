'use client';

import * as React from 'react';
import Script from 'next/script';
import { Button, Input, Label, Select, Card, CardBody, CardHeader } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import {
  dataLayerPush,
  LEAD_SUBMITTED_FLAG,
  PREFILL_ADDRESS_KEY,
} from '@/lib/clientAnalytics';
import {
  fireSellerValuationConversion,
  fireHeroSellerLeadConversion,
} from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';

interface ValuationFormProps {
  locationSlug: string;
  cityName: string;
  pageVariant?: 'seo' | 'ads';
}

interface PlaceData {
  propertyAddress: string;
  propertyLat: number | null;
  propertyLng: number | null;
}

/** Pre-contact teaser returned by /api/valuation — no precise estimate. */
interface Teaser {
  token: string | null;
  rangeLow: number;
  rangeHigh: number;
}

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

const TIMEFRAMES = [
  'In the next 3 months',
  '3–6 months',
  '6–12 months',
  '1–2 years',
  'Just researching',
] as const;

/**
 * Primary lead-capture, multi-step valuation form (Sections 4.3 / 22.5 / 22.6).
 * The address input is the CTA; all page CTAs scroll to and focus it.
 */
export default function ValuationForm({ locationSlug, cityName, pageVariant = 'seo' }: ValuationFormProps) {
  const [sessionId] = React.useState(() => crypto.randomUUID());
  const [step, setStep] = React.useState<1 | 2>(1);
  const [place, setPlace] = React.useState<PlaceData>({
    propertyAddress: '',
    propertyLat: null,
    propertyLng: null,
  });
  const [valuation, setValuation] = React.useState<Teaser | null>(null);
  const [valuationFailed, setValuationFailed] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [timeframe, setTimeframe] = React.useState<string>(TIMEFRAMES[0]);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const addressInputRef = React.useRef<HTMLInputElement>(null);
  const [mapsReady, setMapsReady] = React.useState(false);

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

  // Prefill from the exit-intent overlay (Section 22.2 handoff).
  React.useEffect(() => {
    const stored = sessionStorage.getItem(PREFILL_ADDRESS_KEY);
    if (stored) {
      setPlace((p) => ({ ...p, propertyAddress: stored }));
      if (addressInputRef.current) addressInputRef.current.value = stored;
    }
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) {
        setPlace((p) => ({ ...p, propertyAddress: detail }));
        if (addressInputRef.current) addressInputRef.current.value = detail;
      }
    }
    window.addEventListener('prefill-address', onPrefill);
    return () => window.removeEventListener('prefill-address', onPrefill);
  }, []);

  async function advanceToStep2(data: PlaceData) {
    setError(null);
    setLoading(true);
    dataLayerPush('address_entered', { city: cityName, page_variant: pageVariant });
    try {
      // Best-effort partial capture (non-blocking).
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
            pageVariant,
            ...getLeadAttribution(),
          }),
        });
      } catch {
        /* non-critical */
      }

      // Valuation — never block the form if RentCast fails (Section 22.5).
      try {
        const res = await fetch('/api/valuation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: data.propertyAddress,
            propertyLat: data.propertyLat,
            propertyLng: data.propertyLng,
          }),
        });
        const json = (await res.json()) as Partial<Teaser>;
        if (res.ok && json.rangeLow != null && json.rangeHigh != null) {
          setValuation({
            token: json.token ?? null,
            rangeLow: json.rangeLow,
            rangeHigh: json.rangeHigh,
          });
          dataLayerPush('valuation_viewed', {
            city: cityName,
            estimated_value: Math.round((json.rangeLow + json.rangeHigh) / 2),
          });
        } else {
          setValuationFailed(true);
        }
      } catch {
        setValuationFailed(true);
      }
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    const address = place.propertyAddress.trim() || addressInputRef.current?.value.trim() || '';
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
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.');
      return;
    }
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
          valuationToken: valuation?.token ?? undefined,
          locationSlug,
          leadType: 'valuation',
          pageVariant,
          ...getLeadAttribution(),
        }),
      });
      if (!res.ok) throw new Error('We could not submit your request. Please try again.');
      const data = (await res.json().catch(() => ({}))) as { leadId?: number; reportToken?: string | null };
      const fullName = `${firstName} ${lastName}`.trim();

      // Fire the Google Ads conversion IMMEDIATELY after the confirmed save,
      // before the redirect (§B.4) — value/transaction_id depend on page type.
      if (data.leadId != null) {
        const ud = { email, phone, name: fullName };
        if (pageVariant === 'ads') fireHeroSellerLeadConversion(data.leadId, ud);
        else fireSellerValuationConversion(data.leadId, ud);
      }

      // Handoff for the thank-you conversion event (Section 21.3) + CRO flags.
      sessionStorage.setItem('lead_email', email);
      sessionStorage.setItem('lead_phone', phone);
      sessionStorage.setItem('lead_name', fullName);
      if (data.leadId != null) sessionStorage.setItem('lead_id', String(data.leadId));
      sessionStorage.setItem(LEAD_SUBMITTED_FLAG, '1');
      // Carry the durable report token (falls back to the valuation token) so the
      // Full Valuation page reveals the estimate + IDX sections (IDX spec §5.3).
      const reportParam = data.reportToken
        ? `&report=${encodeURIComponent(data.reportToken)}`
        : valuation?.token
          ? `&v=${encodeURIComponent(valuation.token)}`
          : '';
      window.location.href = `/thank-you?type=valuation&city=${encodeURIComponent(locationSlug)}&variant=${pageVariant}${reportParam}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  return (
    <section id="valuation" className="scroll-mt-20 bg-cream">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <p className="mb-3.5 text-center text-[13px] font-bold uppercase tracking-[0.14em] text-platinum-red">
          Free Home Valuation
        </p>
        {mapsKey ? (
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
            strategy="lazyOnload"
            onLoad={initAutocomplete}
          />
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-2xl font-bold text-charcoal">
              What&apos;s Your {cityName} Home Worth?
            </h2>
            <p className="mt-1 text-sm text-mute">Get an instant, no-obligation estimate in seconds.</p>
          </CardHeader>
          <CardBody>
            {error ? (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red"
              >
                {error}
              </div>
            ) : null}

            {step === 1 ? (
              <form onSubmit={handleStep1Submit} className="space-y-4">
                <div>
                  <Label htmlFor="valuation-address">Property Address</Label>
                  <Input
                    id="valuation-address"
                    ref={addressInputRef}
                    type="text"
                    autoComplete="off"
                    placeholder="Start typing your address…"
                    defaultValue={place.propertyAddress}
                    onChange={(e) => setPlace((p) => ({ ...p, propertyAddress: e.target.value }))}
                    required
                  />
                  {!mapsReady ? (
                    <p className="mt-1 text-xs text-mute-lighter">
                      Type your full address and continue.
                    </p>
                  ) : null}
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Calculating…' : 'Get My Free Home Value →'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleStep2Submit} className="space-y-4">
                {valuation ? (
                  <ValuationRange v={valuation} />
                ) : valuationFailed ? (
                  <div className="rounded-lg border border-line bg-cream px-5 py-5 text-center text-sm text-mute">
                    Our local expert will prepare a personalized valuation based on your home&apos;s
                    specific features.
                  </div>
                ) : null}

                <p className="text-sm text-mute">
                  Your personalized report includes comparable sales, 90-day price trend, and a
                  recommended listing price.
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      autoComplete="given-name"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      autoComplete="family-name"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="email">Where should we send your report?</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your email address"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <Label htmlFor="phone">Best number to reach you</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone number (optional)"
                    autoComplete="tel"
                  />
                </div>

                <div>
                  <Label htmlFor="timeframe">When are you looking to sell?</Label>
                  <Select id="timeframe" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                    {TIMEFRAMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Submitting…' : 'Get My Free Home Valuation →'}
                </Button>
                <p className="text-center text-xs text-mute-light">
                  🔒 Your information is private and will never be shared or sold.
                </p>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}

/** Horizontal teaser range bar with low / high (Section 22.5). The precise
 *  estimate stays gated until contact info is submitted (two-tier gating). */
function ValuationRange({ v }: { v: Teaser }) {
  return (
    <div className="rounded-card bg-cream px-5 py-6">
      <p className="text-center text-sm font-semibold text-mute">Estimated value</p>
      <p className="mt-1 text-center font-numeric text-3xl font-bold text-charcoal sm:text-4xl">
        {formatCurrency(v.rangeLow)} – {formatCurrency(v.rangeHigh)}
      </p>
      <div className="relative mt-5 h-2 rounded-pill bg-line">
        <div className="absolute inset-y-0 left-0 right-0 rounded-pill bg-gradient-to-r from-platinum-red/40 via-platinum-red to-platinum-red/40" />
      </div>
      <div className="mt-2 flex justify-between text-xs text-mute-light">
        <span>{formatCurrency(v.rangeLow)} Low</span>
        <span>{formatCurrency(v.rangeHigh)} High</span>
      </div>
    </div>
  );
}
