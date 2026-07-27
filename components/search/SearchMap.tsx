'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { encodePolygon, parsePolygon, coarsenPin } from '@/lib/listingSearch';
import { formatCurrency } from '@/lib/utils';

export interface MapPin {
  listingKey: string;
  lat: number;
  lng: number;
  price: number | null;
  address: string | null;
  city: string | null;
  status: string;
  hidden: boolean;
  photoUrl: string | null;
}

// SE Michigan-ish default center/zoom when there are no results to frame.
const DEFAULT_CENTER = { lat: 42.73, lng: -83.7 };
const DEFAULT_ZOOM = 9;

// Shared brand styling for the drawn/restored area polygon.
const AREA_STYLE = {
  fillColor: '#0043FF',
  fillOpacity: 0.08,
  strokeColor: '#0043FF',
  strokeWeight: 2,
  clickable: false,
} as const;

// The maps API surface is large and only partially typed in this repo; use a
// local `any` handle rather than pulling in full google.maps typings.
type GMaps = any;

/** Pull the mailing-city name out of a Places `(cities)` autocomplete result. */
function cityNameOf(place: GMaps): string | null {
  if (!place) return null;
  const comps = place.address_components as GMaps[] | undefined;
  const locality = comps?.find((c) => c.types?.includes('locality'))?.long_name as string | undefined;
  const name = (locality || place.name || '').trim();
  return name || null;
}

export default function SearchMap({ pins }: { pins: MapPin[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mapEl = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<GMaps>(null);
  const markersRef = React.useRef<GMaps[]>([]);
  const drawingRef = React.useRef<GMaps>(null);
  const polyOverlayRef = React.useRef<GMaps>(null);
  const infoRef = React.useRef<GMaps>(null);
  const pinnedRef = React.useRef(false); // true when the popover was opened by a click
  const acInputRef = React.useRef<HTMLInputElement>(null);

  const [ready, setReady] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const hasArea = !!(searchParams?.get('poly') || (searchParams?.get('lat') && searchParams?.get('lng')));

  const pushGeo = React.useCallback(
    (geo: { poly?: string; lat?: number; lng?: number; radius?: number } | null) => {
      const p = new URLSearchParams(searchParams?.toString() ?? '');
      ['poly', 'lat', 'lng', 'radius', 'page'].forEach((k) => p.delete(k));
      if (geo?.poly) p.set('poly', geo.poly);
      if (geo?.lat != null && geo?.lng != null) {
        p.set('lat', String(geo.lat));
        p.set('lng', String(geo.lng));
        if (geo.radius) p.set('radius', String(geo.radius));
      }
      router.push(`${pathname}?${p.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Picking a city scopes the search to that mailing city (matches the filter
  // panel's `city` field), NOT a lat/lng/radius circle — clear any drawn area.
  const pushCity = React.useCallback(
    (city: string) => {
      const p = new URLSearchParams(searchParams?.toString() ?? '');
      ['poly', 'lat', 'lng', 'radius', 'page'].forEach((k) => p.delete(k));
      p.set('city', city);
      router.push(`${pathname}?${p.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Initialize the map once.
  React.useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapEl.current) return;
        const g = (window as unknown as { google: GMaps }).google;
        const map = new g.maps.Map(mapEl.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
        infoRef.current = new g.maps.InfoWindow();
        // A pinned (clicked-open) popover un-pins when the user closes it.
        infoRef.current.addListener('closeclick', () => {
          pinnedRef.current = false;
        });

        // Restore a previously-drawn polygon from the URL (visual persistence).
        const existing = parsePolygon(searchParams?.get('poly') ?? undefined);
        if (existing) {
          polyOverlayRef.current = new g.maps.Polygon({ paths: existing, map, ...AREA_STYLE });
        }

        // City autocomplete → filter by that mailing city (no radius circle).
        if (acInputRef.current && g.maps.places) {
          const ac = new g.maps.places.Autocomplete(acInputRef.current, {
            types: ['(cities)'],
            componentRestrictions: { country: 'us' },
            fields: ['name', 'address_components'],
          });
          ac.addListener('place_changed', () => {
            const city = cityNameOf(ac.getPlace());
            if (city) pushCity(city);
          });
        }
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)draw markers whenever the result set changes.
  React.useEffect(() => {
    if (!ready) return;
    const g = (window as unknown as { google: GMaps }).google;
    const map = mapRef.current;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const bounds = new g.maps.LatLngBounds();
    let count = 0;
    for (const p of pins) {
      if (p.lat == null || p.lng == null) continue;
      const pos = coarsenPin(p.lat, p.lng, p.hidden);
      const marker = new g.maps.Marker({ position: pos, map });
      const openPopover = (pinned: boolean) => {
        infoRef.current.setContent(pinHtml(p));
        infoRef.current.open(map, marker);
        pinnedRef.current = pinned;
      };
      // Hover shows the photo preview; click pins it (so it survives on touch and
      // lets you click through to the listing).
      marker.addListener('mouseover', () => {
        if (!pinnedRef.current) openPopover(false);
      });
      marker.addListener('mouseout', () => {
        if (!pinnedRef.current) infoRef.current.close();
      });
      marker.addListener('click', () => openPopover(true));
      markersRef.current.push(marker);
      bounds.extend(pos);
      count++;
    }
    if (count > 0) map.fitBounds(bounds, 48);
  }, [ready, pins]);

  function toggleDraw() {
    const g = (window as unknown as { google: GMaps }).google;
    if (!mapRef.current || !g.maps.drawing) return;
    if (drawing) {
      drawingRef.current?.setDrawingMode(null);
      setDrawing(false);
      return;
    }
    if (!drawingRef.current) {
      drawingRef.current = new g.maps.drawing.DrawingManager({
        drawingMode: g.maps.drawing.OverlayType.POLYGON,
        drawingControl: false,
        polygonOptions: { ...AREA_STYLE },
      });
      drawingRef.current.setMap(mapRef.current);
      g.maps.event.addListener(drawingRef.current, 'polygoncomplete', (poly: GMaps) => {
        polyOverlayRef.current?.setMap(null);
        polyOverlayRef.current = poly;
        drawingRef.current.setDrawingMode(null);
        setDrawing(false);
        const path = poly
          .getPath()
          .getArray()
          .map((pt: GMaps) => ({ lat: pt.lat(), lng: pt.lng() }));
        if (path.length >= 3) pushGeo({ poly: encodePolygon(path) });
      });
    } else {
      drawingRef.current.setDrawingMode(g.maps.drawing.OverlayType.POLYGON);
    }
    setDrawing(true);
  }

  function clearArea() {
    polyOverlayRef.current?.setMap(null);
    polyOverlayRef.current = null;
    pushGeo(null);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => pushGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, radius: 15 }),
      () => {
        /* denied / unavailable — ignore */
      },
    );
  }

  if (failed) return null; // no maps key / load failure: page still works without the map

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-hair p-2.5">
        <input
          ref={acInputRef}
          placeholder="Search a city…"
          className="min-w-[180px] flex-1 rounded-md border border-line px-3 py-1.5 text-sm text-charcoal"
          aria-label="Search a city on the map"
        />
        <button
          type="button"
          onClick={toggleDraw}
          className={`rounded-pill border px-3 py-1.5 text-sm font-semibold ${
            drawing ? 'border-platinum-blue bg-platinum-blue text-white' : 'border-line text-charcoal hover:border-platinum-blue'
          }`}
        >
          {drawing ? 'Click the map to draw…' : '✏ Draw area'}
        </button>
        {hasArea ? (
          <button
            type="button"
            onClick={clearArea}
            className="rounded-pill border border-line px-3 py-1.5 text-sm font-semibold text-mute hover:text-charcoal"
          >
            Clear area
          </button>
        ) : null}
        <button
          type="button"
          onClick={useMyLocation}
          className="rounded-pill border border-line px-3 py-1.5 text-sm font-semibold text-charcoal hover:border-platinum-blue"
        >
          ◎ My location
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto text-sm font-semibold text-platinum-blue hover:underline sm:hidden"
        >
          {collapsed ? 'Show map' : 'Hide map'}
        </button>
      </div>
      <div
        ref={mapEl}
        className={`w-full ${collapsed ? 'hidden' : 'block'}`}
        style={{ height: 420 }}
        aria-label="Map of search results"
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** InfoWindow content for a pin — the listing's main photo + price/address/link. */
function pinHtml(p: MapPin): string {
  const img = p.photoUrl
    ? `<img src="${escapeHtml(p.photoUrl)}" alt="" style="width:100%;height:132px;object-fit:cover;border-radius:6px;display:block;margin-bottom:6px" />`
    : '';
  const addr = p.address ? `${escapeHtml(p.address)}<br/>` : '';
  return (
    `<a href="/listing/${encodeURIComponent(p.listingKey)}" style="text-decoration:none;color:inherit;display:block;width:210px;font:13px/1.4 sans-serif">` +
    img +
    `<strong style="font-size:15px;color:#141418">${p.price != null ? formatCurrency(p.price) : ''}</strong><br/>` +
    `${addr}${escapeHtml(p.city ?? '')}<br/>` +
    `<span style="color:#888">${escapeHtml(p.status)}</span><br/>` +
    `<span style="color:#0043FF;font-weight:600">View details &rarr;</span>` +
    `</a>`
  );
}
