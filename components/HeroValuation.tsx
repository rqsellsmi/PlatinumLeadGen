'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Script from 'next/script';
import { Button, Input, Label, Select } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { dataLayerPush, LEAD_SUBMITTED_FLAG } from '@/lib/clientAnalytics';
import {
  fireSellerValuationConversion,
  fireHeroSellerLeadConversion,
} from '@/lib/googleAdsConversions';
import { getLeadAttribution } from '@/lib/attribution';

/** Fired by the sticky CTA / exit-intent overlay to open this flow. */
export const OPEN_VALUATION_EVENT = 'open-valuation';

interface PlaceData {
  propertyAddress: string;
  propertyLat: number | null;
  propertyLng: number | null;
}
/** Pre-contact teaser returned by /api/valuation — no precise estimate. */
interface Teaser {
  token: string | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  basics: {
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    yearBuilt: number | null;
    lotSizeSqft: number | null;
    propertyType: string | null;
  } | null;
}

const TIMEFRAMES = [
  'In the next 3 months',
  '3–6 months',
  '6–12 months',
  '1–2 years',
  'Just researching',
] as const;

/**
 * Single-box valuation flow used in the hero on the homepage and city pages.
 * The inline address box (Google Places autocomplete) opens a modal that shows
 * the estimate + contact step — no duplicate form on the page. The sticky CTA
 * and exit-intent overlay open the same modal via the OPEN_VALUATION_EVENT.
 */
export default function HeroValuation({
  locationSlug = '',
  cityName = '',
  pageVariant = 'seo',
  buttonLabel = "What's My Home Worth? →",
}: {
  locationSlug?: string;
  cityName?: string;
  pageVariant?: 'seo' | 'ads';
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
  const [modalStep, setModalStep] = React.useState<1 | 2>(2);
  const [valuation, setValuation] = React.useState<Teaser | null>(null);
  const [valuationFailed, setValuationFailed] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [timeframe, setTimeframe] = React.useState<string>(TIMEFRAMES[0]);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mapsReady, setMapsReady] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  // Portal target only exists in the browser.
  React.useEffect(() => setMounted(true), []);

  // Lock body scroll while the modal is open so the page behind doesn't move.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const heroInputRef = React.useRef<HTMLInputElement>(null);
  const modalInputRef = React.useRef<HTMLInputElement>(null);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const attach = React.useCallback((el: HTMLInputElement | null) => {
    const places = window.google?.maps?.places;
    if (!places || !el) return;
    const ac = new places.Autocomplete(el, {
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

  // Attach autocomplete to the hero box once Maps is ready.
  React.useEffect(() => {
    if (window.google?.maps?.places) {
      setMapsReady(true);
      attach(heroInputRef.current);
    }
  }, [attach]);

  // Attach autocomplete to the modal's step-1 input when it appears.
  React.useEffect(() => {
    if (open && modalStep === 1 && mapsReady) attach(modalInputRef.current);
  }, [open, modalStep, mapsReady, attach]);

  const runValuation = React.useCallback(
    async (data: PlaceData) => {
      setError(null);
      setLoading(true);
      setValuation(null);
      setValuationFailed(false);
      dataLayerPush('address_entered', { city: cityName || 'homepage', page_variant: pageVariant });
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
              locationSlug: locationSlug || undefined,
              pageVariant,
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
          const json = (await res.json()) as Partial<Teaser>;
          if (res.ok && json.rangeLow != null && json.rangeHigh != null) {
            setValuation({
              token: json.token ?? null,
              rangeLow: json.rangeLow,
              rangeHigh: json.rangeHigh,
              basics: json.basics ?? null,
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
    },
    [sessionId, cityName, pageVariant, locationSlug],
  );

  // Open from the sticky CTA / exit-intent overlay. The exit-intent overlay now
  // runs its own Places autocomplete, so it can hand off coordinates too.
  React.useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ address?: string; propertyLat?: number | null; propertyLng?: number | null }>).detail;
      const addr = detail?.address?.trim();
      if (addr) {
        const data = {
          propertyAddress: addr,
          propertyLat: detail?.propertyLat ?? null,
          propertyLng: detail?.propertyLng ?? null,
        };
        setAddress(addr);
        setPlace(data);
        setModalStep(2);
        setOpen(true);
        void runValuation(data);
      } else {
        setModalStep(1);
        setOpen(true);
      }
    }
    window.addEventListener(OPEN_VALUATION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VALUATION_EVENT, onOpen);
  }, [runValuation]);

  function startFromAddress(e: React.FormEvent) {
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
    setModalStep(2);
    setOpen(true);
    void runValuation(data);
  }

  async function submitDetails(e: React.FormEvent) {
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
          leadType: 'valuation',
          locationSlug: locationSlug || '',
          pageVariant,
          ...getLeadAttribution(),
        }),
      });
      if (!res.ok) throw new Error('We could not submit your request. Please try again.');
      const data = (await res.json().catch(() => ({}))) as { leadId?: number; reportToken?: string | null };
      const fullName = `${firstName} ${lastName}`.trim();
      if (data.leadId != null) {
        const ud = { email, phone, name: fullName };
        if (pageVariant === 'ads') fireHeroSellerLeadConversion(data.leadId, ud);
        else fireSellerValuationConversion(data.leadId, ud);
        sessionStorage.setItem('lead_id', String(data.leadId));
      }
      sessionStorage.setItem('lead_email', email);
      sessionStorage.setItem('lead_phone', phone);
      sessionStorage.setItem('lead_name', fullName);
      sessionStorage.setItem('lead_address', place.propertyAddress);
      sessionStorage.setItem(LEAD_SUBMITTED_FLAG, '1');
      // The precise estimate + detail live server-side; the report page reveals
      // them by token once the lead is linked (the gate). Carry the token.
      const cityParam = locationSlug ? `&city=${encodeURIComponent(locationSlug)}` : '';
      // Prefer the durable report token (also in the confirmation email + used for
      // the IDX Full Valuation page); fall back to the valuation token.
      const reportParam = data.reportToken
        ? `&report=${encodeURIComponent(data.reportToken)}`
        : valuation?.token
          ? `&v=${encodeURIComponent(valuation.token)}`
          : '';
      window.location.href = `/thank-you?type=valuation${cityParam}&variant=${pageVariant}${reportParam}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const homeLabel = cityName ? `your ${cityName} home` : 'your home';

  return (
    <>
      {mapsKey ? (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
          strategy="afterInteractive"
          onLoad={() => {
            setMapsReady(true);
            attach(heroInputRef.current);
          }}
        />
      ) : null}

      {/* Hero address box. Wider on desktop so the full address stays visible
          (the button is wide, so a narrow form clipped long addresses). */}
      <form
        onSubmit={startFromAddress}
        className="flex w-full max-w-xl flex-wrap gap-2.5 rounded-2xl bg-white p-2.5 shadow-[0_18px_48px_rgba(20,20,24,0.3)] sm:max-w-2xl lg:max-w-3xl"
      >
        <div className="flex flex-1 basis-72 items-center gap-2.5 rounded-xl border-[1.5px] border-line px-4">
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-platinum-red" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <input
            ref={heroInputRef}
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

      {/* Modal — portaled to <body> so it escapes the hero's `isolate`
          stacking context and covers the sticky header + floating CTA bar. */}
      {open && mounted
        ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4">
          <div className="absolute inset-0 animate-fadeIn bg-[rgba(20,20,24,0.55)]" onClick={() => setOpen(false)} aria-hidden />
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

            {modalStep === 1 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = place.propertyAddress.trim() || address.trim();
                  if (!value) {
                    setError('Please enter your home address.');
                    return;
                  }
                  const data = { propertyAddress: value, propertyLat: place.propertyLat, propertyLng: place.propertyLng };
                  setPlace(data);
                  setModalStep(2);
                  void runValuation(data);
                }}
                className="space-y-4"
              >
                <h2 className="text-xl font-bold text-charcoal">What&apos;s {homeLabel} worth?</h2>
                <p className="text-sm text-mute">Enter your address for an instant, no-obligation estimate.</p>
                {error ? (
                  <div role="alert" className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red">
                    {error}
                  </div>
                ) : null}
                <Input
                  ref={modalInputRef}
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setPlace((p) => ({ ...p, propertyAddress: e.target.value }));
                  }}
                  autoComplete="off"
                  placeholder="123 Main St, Brighton, MI"
                />
                <Button type="submit" size="lg" className="w-full">
                  Get my estimate →
                </Button>
              </form>
            ) : loading && !valuation && !valuationFailed ? (
              <div className="py-10 text-center">
                <p className="font-semibold text-charcoal">Calculating your estimate…</p>
                <p className="mt-1 text-sm text-mute-light">{place.propertyAddress}</p>
              </div>
            ) : (
              <form onSubmit={submitDetails} className="space-y-4">
                {valuation && valuation.rangeLow != null && valuation.rangeHigh != null ? (
                  <div className="rounded-card bg-cream px-5 py-6 text-center">
                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                      Ballpark range for {place.propertyAddress}
                    </p>
                    <p className="mt-1 font-numeric text-3xl font-bold text-charcoal sm:text-4xl">
                      {formatCurrency(valuation.rangeLow)} – {formatCurrency(valuation.rangeHigh)}
                    </p>
                    {valuation.basics &&
                    (valuation.basics.beds != null ||
                      valuation.basics.baths != null ||
                      valuation.basics.sqft != null ||
                      valuation.basics.yearBuilt != null) ? (
                      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-mute">
                        {valuation.basics.beds != null ? <span>{valuation.basics.beds} bd</span> : null}
                        {valuation.basics.baths != null ? <span>{valuation.basics.baths} ba</span> : null}
                        {valuation.basics.sqft != null ? (
                          <span>{valuation.basics.sqft.toLocaleString()} sqft</span>
                        ) : null}
                        {valuation.basics.yearBuilt != null ? (
                          <span>Built {valuation.basics.yearBuilt}</span>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="mt-3 text-xs text-mute-light">
                      Enter your details below to unlock the precise estimate and full report.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-card border border-line bg-cream px-5 py-5 text-center text-sm text-mute">
                    A local Platinum expert will prepare a personalized valuation for{' '}
                    <strong>{place.propertyAddress}</strong>.
                  </div>
                )}
                <p className="text-center text-sm text-mute">
                  Where should we send your full report? A local expert will refine this range and reach out within 24 hours.
                </p>
                {error ? (
                  <div role="alert" className="rounded-lg border border-platinum-red/30 bg-danger-bg px-4 py-3 text-sm text-platinum-red">
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
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
