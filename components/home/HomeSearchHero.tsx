'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import HeroValuation from '@/components/HeroValuation';
import { loadGoogleMaps } from '@/lib/googleMaps';

type Tab = 'search' | 'value';

// The buyer homepage hero: a "Search homes" location box (default) + a
// "What's my home worth?" tab that launches the existing valuation flow.
export default function HomeSearchHero() {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>('search');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState('');

  // City/area autocomplete on the search box.
  React.useEffect(() => {
    if (tab !== 'search') return;
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return;
        const g = (window as unknown as { google: any }).google;
        if (!g?.maps?.places) return;
        const ac = new g.maps.places.Autocomplete(inputRef.current, {
          types: ['(cities)'],
          componentRestrictions: { country: 'us' },
          fields: ['name', 'geometry'],
        });
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          const name = place?.name as string | undefined;
          const loc = place?.geometry?.location;
          if (loc) {
            router.push(`/homes?lat=${loc.lat()}&lng=${loc.lng()}&radius=12`);
          } else if (name) {
            router.push(`/homes?city=${encodeURIComponent(name)}`);
          }
        });
      })
      .catch(() => {
        /* no maps key — the button still submits the typed text */
      });
    return () => {
      cancelled = true;
    };
  }, [tab, router]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/homes?city=${encodeURIComponent(q)}` : '/homes');
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-3 flex gap-1 rounded-t-xl">
        <button
          type="button"
          onClick={() => setTab('search')}
          className={`rounded-t-lg px-5 py-2.5 text-sm font-bold transition-colors ${
            tab === 'search' ? 'bg-white text-charcoal' : 'bg-white/20 text-white hover:bg-white/30'
          }`}
        >
          Search homes
        </button>
        <button
          type="button"
          onClick={() => setTab('value')}
          className={`rounded-t-lg px-5 py-2.5 text-sm font-bold transition-colors ${
            tab === 'value' ? 'bg-white text-charcoal' : 'bg-white/20 text-white hover:bg-white/30'
          }`}
        >
          What&rsquo;s my home worth?
        </button>
      </div>

      {tab === 'search' ? (
        <div>
          <form
            onSubmit={submitSearch}
            className="flex w-full flex-wrap gap-2.5 rounded-2xl bg-white p-2.5 shadow-[0_18px_48px_rgba(20,20,24,0.3)]"
          >
            <div className="flex flex-1 basis-72 items-center gap-2.5 rounded-xl border-[1.5px] border-line px-4">
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-platinum-blue" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
                placeholder="City, neighborhood, or ZIP"
                aria-label="Search homes by location"
                className="w-full border-none bg-transparent py-4 text-base text-ink outline-none placeholder:text-mute-lighter"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-platinum-red px-7 py-4 text-base font-bold text-white transition-colors hover:bg-platinum-redHover"
            >
              Search
            </button>
          </form>
          <div className="mt-2.5">
            <Link href="/homes?advanced=1" className="text-sm font-semibold text-white/90 hover:text-white">
              Advanced search →
            </Link>
          </div>
        </div>
      ) : (
        <div>
          <HeroValuation buttonLabel="What's My Home Worth? →" />
        </div>
      )}
    </div>
  );
}
