'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { SearchFilters, SearchSort } from '@/lib/listingSearch';

const BED_BATH = [0, 1, 2, 3, 4, 5];
const PROPERTY_TYPES: { label: string; value: string }[] = [
  { label: 'Houses', value: 'Single Family' },
  { label: 'Condos', value: 'Condo' },
  { label: 'Multi-Family', value: 'Multi' },
  { label: 'Land', value: 'Land' },
  { label: 'Manufactured', value: 'Manufactured' },
];
const SORTS: { label: string; value: SearchSort }[] = [
  { label: 'Newest', value: 'newest' },
  { label: 'Price (low → high)', value: 'price_asc' },
  { label: 'Price (high → low)', value: 'price_desc' },
  { label: 'Days on market', value: 'dom' },
];

type Draft = {
  priceMin: string;
  priceMax: string;
  bedsMin: number;
  bathsMin: number;
  city: string;
  sqftMin: string;
  sqftMax: string;
  yearMin: string;
  yearMax: string;
  lotAcresMin: string;
  garageMin: string;
  hoaMax: string;
  domMax: string;
  propertyTypes: string[];
  waterfront: boolean;
  pool: boolean;
  newConstruction: boolean;
  basementFinished: boolean;
  fireplace: boolean;
  sort: SearchSort;
};

function toDraft(f: SearchFilters): Draft {
  return {
    priceMin: f.priceMin != null ? String(f.priceMin) : '',
    priceMax: f.priceMax != null ? String(f.priceMax) : '',
    bedsMin: f.bedsMin ?? 0,
    bathsMin: f.bathsMin ?? 0,
    city: f.city ?? '',
    sqftMin: f.sqftMin != null ? String(f.sqftMin) : '',
    sqftMax: f.sqftMax != null ? String(f.sqftMax) : '',
    yearMin: f.yearMin != null ? String(f.yearMin) : '',
    yearMax: f.yearMax != null ? String(f.yearMax) : '',
    lotAcresMin: f.lotAcresMin != null ? String(f.lotAcresMin) : '',
    garageMin: f.garageMin != null ? String(f.garageMin) : '',
    hoaMax: f.hoaMax != null ? String(f.hoaMax) : '',
    domMax: f.domMax != null ? String(f.domMax) : '',
    propertyTypes: f.propertyTypes ?? [],
    waterfront: !!f.waterfront,
    pool: !!f.pool,
    newConstruction: !!f.newConstruction,
    basementFinished: !!f.basementFinished,
    fireplace: !!f.fireplace,
    sort: f.sort ?? 'newest',
  };
}

export default function SearchFilterPanel({
  filters,
  advancedOpen = false,
  resultCount,
}: {
  filters: SearchFilters;
  advancedOpen?: boolean;
  resultCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [d, setD] = React.useState<Draft>(() => toDraft(filters));
  const [advanced, setAdvanced] = React.useState(advancedOpen);
  const spString = searchParams?.toString() ?? '';

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  // Build the querystring for a draft, preserving map/geo params already in the URL.
  const buildQs = React.useCallback(
    (next: Draft): string => {
      const p = new URLSearchParams();
      for (const key of ['poly', 'lat', 'lng', 'radius'] as const) {
        const v = searchParams?.get(key);
        if (v) p.set(key, v);
      }
      if (next.priceMin) p.set('priceMin', next.priceMin);
      if (next.priceMax) p.set('priceMax', next.priceMax);
      if (next.bedsMin) p.set('bedsMin', String(next.bedsMin));
      if (next.bathsMin) p.set('bathsMin', String(next.bathsMin));
      if (next.city.trim()) p.set('city', next.city.trim());
      if (next.sqftMin) p.set('sqftMin', next.sqftMin);
      if (next.sqftMax) p.set('sqftMax', next.sqftMax);
      if (next.yearMin) p.set('yearMin', next.yearMin);
      if (next.yearMax) p.set('yearMax', next.yearMax);
      if (next.lotAcresMin) p.set('lotAcresMin', next.lotAcresMin);
      if (next.garageMin) p.set('garageMin', next.garageMin);
      if (next.hoaMax) p.set('hoaMax', next.hoaMax);
      if (next.domMax) p.set('domMax', next.domMax);
      if (next.propertyTypes.length) p.set('propertyTypes', next.propertyTypes.join(','));
      if (next.waterfront) p.set('waterfront', '1');
      if (next.pool) p.set('pool', '1');
      if (next.newConstruction) p.set('newConstruction', '1');
      if (next.basementFinished) p.set('basementFinished', '1');
      if (next.fireplace) p.set('fireplace', '1');
      if (next.sort && next.sort !== 'newest') p.set('sort', next.sort);
      return p.toString();
    },
    [searchParams],
  );

  // Re-sync the draft when the URL changes from outside (city tile, map, back).
  React.useEffect(() => {
    setD(toDraft(filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spString]);

  // Auto-apply: whenever the draft differs from the URL's filter state, push it
  // (debounced) so results update live — no Apply button needed.
  React.useEffect(() => {
    const target = buildQs(d);
    if (target === buildQs(toDraft(filters))) return; // already in sync
    const t = setTimeout(() => router.push(`${pathname}?${target}`), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  function reset() {
    router.push(pathname);
  }

  const toggleType = (v: string) =>
    set(
      'propertyTypes',
      d.propertyTypes.includes(v) ? d.propertyTypes.filter((t) => t !== v) : [...d.propertyTypes, v],
    );

  const pill = (active: boolean) =>
    `rounded-pill border px-3 py-1.5 text-sm font-semibold transition-colors ${
      active
        ? 'border-platinum-blue bg-platinum-blue text-white'
        : 'border-line bg-white text-charcoal hover:border-platinum-blue'
    }`;

  return (
    <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs font-semibold text-mute">
          City / area
          <input
            value={d.city}
            onChange={(e) => set('city', e.target.value)}
            placeholder="e.g. Fenton"
            className="mt-1 w-40 rounded-md border border-line px-3 py-2 text-sm text-charcoal"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-mute">
          Min price
          <input
            value={d.priceMin}
            onChange={(e) => set('priceMin', e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder="No min"
            className="mt-1 w-28 rounded-md border border-line px-3 py-2 text-sm text-charcoal"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-mute">
          Max price
          <input
            value={d.priceMax}
            onChange={(e) => set('priceMax', e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder="No max"
            className="mt-1 w-28 rounded-md border border-line px-3 py-2 text-sm text-charcoal"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-mute">
          Sort
          <select
            value={d.sort}
            onChange={(e) => set('sort', e.target.value as SearchSort)}
            className="mt-1 rounded-md border border-line px-3 py-2 text-sm text-charcoal"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-semibold text-mute">Beds</p>
          <div className="mt-1 flex gap-1.5">
            {BED_BATH.map((n) => (
              <button key={n} type="button" className={pill(d.bedsMin === n)} onClick={() => set('bedsMin', n)}>
                {n === 0 ? 'Any' : `${n}+`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-mute">Baths</p>
          <div className="mt-1 flex gap-1.5">
            {BED_BATH.map((n) => (
              <button key={n} type="button" className={pill(d.bathsMin === n)} onClick={() => set('bathsMin', n)}>
                {n === 0 ? 'Any' : `${n}+`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {advanced ? (
        <div className="mt-4 border-t border-line-hair pt-4">
          <div className="flex flex-wrap gap-2">
            {PROPERTY_TYPES.map((t) => (
              <button key={t.value} type="button" className={pill(d.propertyTypes.includes(t.value))} onClick={() => toggleType(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <NumField label="Min sqft" value={d.sqftMin} onChange={(v) => set('sqftMin', v)} />
            <NumField label="Max sqft" value={d.sqftMax} onChange={(v) => set('sqftMax', v)} />
            <NumField label="Year built (min)" value={d.yearMin} onChange={(v) => set('yearMin', v)} />
            <NumField label="Year built (max)" value={d.yearMax} onChange={(v) => set('yearMax', v)} />
            <NumField label="Min acres" value={d.lotAcresMin} onChange={(v) => set('lotAcresMin', v)} decimal />
            <NumField label="Min garage" value={d.garageMin} onChange={(v) => set('garageMin', v)} />
            <NumField label="Max HOA/mo" value={d.hoaMax} onChange={(v) => set('hoaMax', v)} />
            <NumField label="Max days on mkt" value={d.domMax} onChange={(v) => set('domMax', v)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Toggle label="Waterfront" on={d.waterfront} onClick={() => set('waterfront', !d.waterfront)} />
            <Toggle label="Pool" on={d.pool} onClick={() => set('pool', !d.pool)} />
            <Toggle label="New construction" on={d.newConstruction} onClick={() => set('newConstruction', !d.newConstruction)} />
            <Toggle label="Finished basement" on={d.basementFinished} onClick={() => set('basementFinished', !d.basementFinished)} />
            <Toggle label="Fireplace" on={d.fireplace} onClick={() => set('fireplace', !d.fireplace)} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-hair pt-4">
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="text-sm font-semibold text-platinum-blue hover:underline"
        >
          {advanced ? 'Hide advanced' : 'Advanced search'}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-charcoal">{resultCount.toLocaleString()} homes</span>
          <button type="button" onClick={reset} className="text-sm font-semibold text-mute hover:text-charcoal">
            Reset all
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  decimal,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
}) {
  return (
    <label className="flex flex-col text-xs font-semibold text-mute">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ''))}
        inputMode={decimal ? 'decimal' : 'numeric'}
        className="mt-1 w-28 rounded-md border border-line px-3 py-2 text-sm text-charcoal"
      />
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-pill border px-3 py-1.5 text-sm font-semibold transition-colors ${
        on ? 'border-platinum-blue bg-platinum-blue text-white' : 'border-line bg-white text-charcoal hover:border-platinum-blue'
      }`}
    >
      {label}
    </button>
  );
}
