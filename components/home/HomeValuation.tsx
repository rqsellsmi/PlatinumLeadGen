'use client';

import * as React from 'react';
import Script from 'next/script';
import { Button, Input, Label, Select } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { dataLayerPush, LEAD_SUBMITTED_FLAG } from '@/lib/clientAnalytics';
import { fireSellerValuationConversion } from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';

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

const TIMEFRAMES = [
  'In the next 3 months',
  '3–6 months',
  '6–12 months',
  '1–2 years',
  'Just researching',
] as const;

/**
 * Homepage hero valuation: a single address box (with Google Places
 * autocomplete) that, on submit, runs the valuation and opens the estimate +
 * contact step in a modal — no duplicate form lower on the page. City-less
 * leads route by property proximity.
 */
export default function HomeValuation({
  buttonLabel = "What's My Home Worth? →",
}: {
  buttonLabel?: string;
}) {
  const [sessionId] = React.useState(() => crypto.randomUUID());
  const [address, setAddress] = React.useState('');
  const [place, setPlace] = React.useState<PlaceData>({
    propertyAddress: '',
    propertyLat: null,
    propertyLng: null,
  });
  const [open, setOpen] = React.useState(false);
  const [valuation, setValuation] = React.useState<ValuationResult | null>(null);
  const [valuationFailed, setValuationFailed] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [timeframe, setTimeframe] = React.useState<string>(TIMEFRAMES[0]);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const initAutocomplete = React.useCallback(() => {
    const places = window.google?.maps?.places;
    if (!places || !inputRef.current) return;
    const ac = new places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry'],
    });
    ac.addListener('place_changed', () => {
      const sel = ac.getPlace();
      const formatted = sel.formatted_address;
      const loc = sel.geometry?.location;
      if (!formatted) return;
      setAddress(formatted);
      setPlace({
        propertyAddress: formatted,
        propertyLat: loc ? loc.lat() : null,
        propertyLng: loc ? loc.lng() : null,
      });
    });
  }, []);

  React.useEffect(() => {
    if (window.google?.maps?.places) initAutocomplete();
  }, [initAutocomplete]);

  async function runValuation(data: PlaceData) {
    setError(null);
    setLoading(true);
    setValuation(null);
    setValuationFailed(false);
    dataLayerPush('address_entered', { city: 'homepage', page_variant: 'seo' });
    try {
      try {
        await fetch('/api/leads/partial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            propertyAddress: data.propertyAddress,
            propertyLat: data.propertyLat,
            propertyLng: data.propertyLng,
            pageVariant: 'seo',
            ...getLeadAttribution(),
          }),
        });
      } catch {
        /* non-critical */
      }
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
        const json = (await res.json()) as Partial<ValuationResult>;
        if (
          res.ok &&
          json.estimatedValue != null &&
          json.priceRangeLow != null &&
          json.priceRangeHigh != null
        ) {
          setValuation({
            estimatedValue: json.estimatedValue,
            priceRangeLow: json.priceRangeLow,
            priceRangeHigh: json.priceRangeHigh,
          });
        } else {
          setValuationFailed(true);
        }
      } catch {
        setValuationFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleAddressSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = place.propertyAddress.trim() || address.trim();
    if (!value) {
      setError('Please enter your home address.');
      return;
    }
    const data: PlaceData = {
      propertyAddress: value,
      propertyLat: place.propertyLat,
      propertyLng: place.propertyLng,
    };
    setPlace(data);
    setOpen(true);
    void runValuation(data);
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
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
          estimatedValue: valuation?.estimatedValue,
          priceRangeLow: valuation?.priceRangeLow,
          priceRangeHigh: valuation?.priceRangeHigh,
          leadType: 'valuation',
          locationSlug: '',
          pageVariant: 'seo',
          ...getLeadAttribution(),
        }),
      });
      if (!res.ok) throw new Error('We could not submit your request. Please try again.');
      const data = (await res.json().catch(() => ({}))) as { leadId?: number };
      const fullName = `${firstName} ${lastName}`.trim();
      if (data.leadId != null) {
        fireSellerValuationConversion(data.leadId, { email, phone, name: fullName });
        sessionStorage.setItem('lead_id', String(data.leadId));
      }
      sessionStorage.setItem('lead_email', email);
      sessionStorage.setItem('lead_phone', phone);
      sessionStorage.setItem('lead_name', fullName);
      sessionStorage.setItem(LEAD_SUBMITTED_FLAG, '1');
      window.location.href = `/thank-you?type=valuation&variant=seo`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <>
      {mapsKey ? (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
          strategy="afterInteractive"
          onLoad={initAutocomplete}
        />
      ) : null}

      {/* Hero address box */}
      <form
        onSubmit={handleAddressSubmit}
        className="flex max-w-xl flex-wrap gap-2.5 rounded-2xl bg-white p-2.5 shadow-[0_18px_48px_rgba(20,20,24,0.3)]"
      >
        <div className="flex flex-1 basis-60 items-center gap-2.5 rounded-xl border-[1.5px] border-line px-4">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-platinum-red"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <input
            ref={inputRef}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setPlace((p) => ({ ...p, propertyAddress: e.target.value }));
            }}
            autoComplete="off"
            placeholder="Enter your home address"
            aria-label="Your home address"
            className="w-full border-none bg-transparent py-4 text-base text-ink outline-none placeholder:text-mute-lighter"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-platinum-red px-6 py-4 text-base font-bold text-white transition-colors hover:bg-platinum-redHover"
        >
          {buttonLabel}
        </button>
      </form>

      {/* Modal: estimate + contact (step 2) */}
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 animate-fadeIn bg-[rgba(20,20,24,0.55)]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(20,20,24,0.3)] sm:p-8"
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-offwhite text-xl leading-none text-mute-light hover:text-charcoal"
            >
              ×
            </button>

            {loading && !valuation && !valuationFailed ? (
              <div className="py-10 text-center">
                <p className="font-semibold text-charcoal">Calculating your estimate…</p>
                <p className="mt-1 text-sm text-mute-light">{place.propertyAddress}</p>
              </div>
            ) : (
              <form onSubmit={handleDetailsSubmit} className="space-y-4">
                {valuation ? (
                  <div className="rounded-card bg-cream px-5 py-6 text-center">
                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                      Estimated value for {place.propertyAddress}
                    </p>
                    <p className="mt-1 font-numeric text-3xl font-bold text-charcoal sm:text-4xl">
                      {formatCurrency(valuation.priceRangeLow)} – {formatCurrency(valuation.priceRangeHigh)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-card border border-line bg-cream px-5 py-5 text-center text-sm text-mute">
                    A local Platinum expert will prepare a personalized valuation for{' '}
                    <strong>{place.propertyAddress}</strong>.
                  </div>
                )}

                <p className="text-center text-sm text-mute">
                  Where should we send your full report? A local expert will refine this range and
                  reach out within 24 hours.
                </p>

                {error ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red"
                  >
                    {error}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="hv-first">First name</Label>
                    <Input id="hv-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
                  </div>
                  <div>
                    <Label htmlFor="hv-last">Last name</Label>
                    <Input id="hv-last" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />
                  </div>
                </div>
                <div>
                  <Label htmlFor="hv-email">Email</Label>
                  <Input id="hv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="hv-phone">Phone (optional)</Label>
                  <Input id="hv-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                </div>
                <div>
                  <Label htmlFor="hv-timeframe">When are you looking to sell?</Label>
                  <Select id="hv-timeframe" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                    {TIMEFRAMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Submitting…' : 'See my full report →'}
                </Button>
                <p className="text-center text-xs text-mute-light">
                  Free · No obligation · We never share your information.
                </p>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
