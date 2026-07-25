'use client';

import * as React from 'react';
import Script from 'next/script';
import { Button, Input, Label } from '@/components/ui';

/**
 * Address input for the admin AVM backtest, with the SAME Google Places
 * autocomplete the public valuation forms use (HeroValuation / ValuationForm) —
 * loaded via next/script with the `places` library, attached to the input, and on
 * selection the input's value is set to the formatted address. The form is a plain
 * GET (the page reads `?address=`), so an uncontrolled input carrying the selected
 * value is all we need. Degrades to a normal text field when no Maps key is set.
 */
export default function AvmAddressForm({ defaultValue }: { defaultValue?: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const attach = React.useCallback(() => {
    const places = window.google?.maps?.places;
    const el = inputRef.current;
    if (!places || !el) return;
    const ac = new places.Autocomplete(el, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address'],
    });
    ac.addListener('place_changed', () => {
      const sel = ac.getPlace();
      if (sel.formatted_address && inputRef.current) inputRef.current.value = sel.formatted_address;
    });
  }, []);

  // If Maps is already loaded (navigating back to the page), attach immediately;
  // otherwise the Script onReady/onLoad below attaches once it lands.
  React.useEffect(() => {
    if (window.google?.maps?.places) attach();
  }, [attach]);

  return (
    <>
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="address">Sold property address</Label>
          <Input
            id="address"
            name="address"
            ref={inputRef}
            defaultValue={defaultValue}
            placeholder="123 Lakeshore Dr, Fenton, MI 48430"
            autoComplete="off"
          />
        </div>
        <Button type="submit">Run backtest</Button>
      </form>
      {mapsKey ? (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places`}
          strategy="afterInteractive"
          onReady={attach}
          onLoad={attach}
        />
      ) : null}
    </>
  );
}
