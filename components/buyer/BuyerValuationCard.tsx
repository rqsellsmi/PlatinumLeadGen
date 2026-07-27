'use client';

import * as React from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { formatCurrency } from '@/lib/utils';
import { askRepresentation } from './RepresentationModal';

interface Estimate {
  estimatedValue: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
}

/**
 * "My home value" card in the account area. A signed-in buyer enters their own
 * address (Places autocomplete) and sees the full estimate — no reveal gate,
 * they're a known contact. The request is a potential-seller signal that runs
 * the lead-on-engagement path (representation asked once, if needed).
 */
export default function BuyerValuationCard() {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [address, setAddress] = React.useState('');
  const [coords, setCoords] = React.useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [loading, setLoading] = React.useState(false);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        const places = window.google?.maps?.places;
        if (cancelled || !places || !inputRef.current) return;
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
          setCoords({ lat: loc ? loc.lat() : null, lng: loc ? loc.lng() : null });
        });
      })
      .catch(() => {
        /* no maps key — the plain input still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!address.trim()) return setError('Enter your home address.');
    setLoading(true);
    try {
      const res = await fetch('/api/buyer/valuation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim(), lat: coords.lat, lng: coords.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'failed');
      setEstimate(data.estimate ?? null);
      if (data.needsRepresentation) {
        const answer = await askRepresentation();
        if (answer) {
          await fetch('/api/buyer/engage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'valuation', address: address.trim(), lat: coords.lat, lng: coords.lng, representation: answer }),
          }).catch(() => {});
        }
      }
    } catch {
      setError('We couldn’t get an estimate right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h2 className="text-xl font-bold text-charcoal">My home value</h2>
      <p className="mt-1 text-sm text-mute">Curious what your current home is worth? Get an instant estimate.</p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          ref={inputRef}
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter your home address"
          className="w-full rounded-md border border-line px-3 py-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-pill bg-platinum-red px-5 py-2.5 text-sm font-bold text-white hover:bg-platinum-redHover disabled:opacity-60"
        >
          {loading ? 'Estimating…' : 'Get estimate'}
        </button>
      </form>
      {error ? <p className="mt-2 text-sm font-semibold text-danger">{error}</p> : null}

      {estimate ? (
        estimate.estimatedValue != null ? (
          <div className="mt-5 rounded-xl bg-cream/60 p-5">
            <p className="text-sm text-mute">Estimated value</p>
            <p className="font-numeric text-3xl font-black text-charcoal">{formatCurrency(estimate.estimatedValue)}</p>
            {estimate.priceRangeLow != null && estimate.priceRangeHigh != null ? (
              <p className="mt-1 text-sm text-mute">
                Range {formatCurrency(estimate.priceRangeLow)} – {formatCurrency(estimate.priceRangeHigh)}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-mute-light">
              An automated estimate. For a precise, expert valuation, one of our agents can help.
            </p>
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-cream/60 p-5 text-sm text-mute">
            We couldn’t find an automated estimate for that address. An agent can prepare one for you.
          </p>
        )
      ) : null}
    </div>
  );
}
