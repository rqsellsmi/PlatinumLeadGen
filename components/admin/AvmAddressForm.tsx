'use client';

import * as React from 'react';
import Script from 'next/script';
import { Button, Input, Label } from '@/components/ui';

export interface UpdateDefaults {
  add_beds: string;
  add_baths: string;
  add_sqft: string;
  add_garage: string;
  fin_basement: boolean;
  add_walkout: boolean;
  add_egress: boolean;
  add_pool: boolean;
  add_pole_barn: boolean;
}

/**
 * Address input for the admin AVM backtest, with the SAME Google Places
 * autocomplete the public valuation forms use, PLUS an optional "major updates
 * since the last sale" section (finished basement, added bed/bath/sqft, etc.).
 * Everything is a single GET form, so the page reads it all from the query string;
 * the update fields fold into the subject before valuation (spec §5.2). Degrades to
 * a plain text field when no Maps key is set.
 */
export default function AvmAddressForm({
  defaultValue,
  updateDefaults,
}: {
  defaultValue?: string;
  updateDefaults?: UpdateDefaults;
}) {
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

  React.useEffect(() => {
    if (window.google?.maps?.places) attach();
  }, [attach]);

  const u = updateDefaults;
  const hasUpdates =
    !!u &&
    (!!u.add_beds || !!u.add_baths || !!u.add_sqft || !!u.add_garage ||
      u.fin_basement || u.add_walkout || u.add_egress || u.add_pool || u.add_pole_barn);

  return (
    <>
      <form method="get" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
        </div>

        <details open={hasUpdates} className="rounded-lg border border-line bg-cream/60 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-charcoal">
            Major updates since the last sale (optional)
          </summary>
          <p className="mt-1 text-xs text-mute-lighter">
            The subject&apos;s facts come from its prior sale, which can be stale. Record big changes made
            since — they&apos;re added to the subject so the estimate reflects the home as it is today.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumField name="add_beds" label="+ Bedrooms" defaultValue={u?.add_beds} />
            <NumField name="add_baths" label="+ Bathrooms" defaultValue={u?.add_baths} step="0.5" />
            <NumField name="add_sqft" label="+ Living area (sqft)" defaultValue={u?.add_sqft} step="10" />
            <NumField name="add_garage" label="+ Garage bays" defaultValue={u?.add_garage} />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <CheckField name="fin_basement" label="Finished the basement" defaultChecked={u?.fin_basement} />
            <CheckField name="add_walkout" label="Added a walkout" defaultChecked={u?.add_walkout} />
            <CheckField name="add_egress" label="Added an egress window" defaultChecked={u?.add_egress} />
            <CheckField name="add_pool" label="Added an in-ground pool" defaultChecked={u?.add_pool} />
            <CheckField name="add_pole_barn" label="Added a pole barn" defaultChecked={u?.add_pole_barn} />
          </div>
        </details>
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

function NumField({ name, label, defaultValue, step }: { name: string; label: string; defaultValue?: string; step?: string }) {
  return (
    <div>
      <Label htmlFor={name} className="text-xs">{label}</Label>
      <Input id={name} name={name} type="number" min="0" step={step ?? '1'} defaultValue={defaultValue || ''} placeholder="0" />
    </div>
  );
}

function CheckField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-charcoal">
      <input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} className="h-4 w-4 rounded border-line" />
      {label}
    </label>
  );
}
