'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { parsePolygon, coarsenPin } from '@/lib/listingSearch';
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

// Radius (miles) used when a URL carries lat/lng but no explicit radius — matches
// the normalizeFilters default so the restored circle mirrors the search.
const DEFAULT_RADIUS_MILES = 15;
const METERS_PER_MILE = 1609.344;

// Shared brand styling for the drawn/restored area overlay (circle or polygon).
const AREA_STYLE = {
  fillColor: '#0043FF',
  fillOpacity: 0.08,
  strokeColor: '#0043FF',
  strokeWeight: 2,
  clickable: false,
} as const;

const milesToMeters = (mi: number) => mi * METERS_PER_MILE;
const metersToMiles = (m: number) => m / METERS_PER_MILE;
const round2 = (n: number) => Math.round(n * 100) / 100;

// The maps API surface is large and only partially typed in this repo; use a
// local `any` handle rather than pulling in full google.maps typings.
type GMaps = any;

export default function SearchMap({ pins }: { pins: MapPin[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mapEl = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<GMaps>(null);
  const markersRef = React.useRef<GMaps[]>([]);
  const drawingRef = React.useRef<GMaps>(null);
  // Holds the currently-drawn area overlay (a Circle, or a Polygon restored from
  // a saved search's `poly` param). Both expose `.setMap(null)` for clearing.
  const areaOverlayRef = React.useRef<GMaps>(null);
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

        // Restore a previously-drawn area from the URL (visual persistence): a
        // circle from lat/lng/radius, or a polygon from a saved search's `poly`.
        const cLat = parseFloat(searchParams?.get('lat') ?? '');
        const cLng = parseFloat(searchParams?.get('lng') ?? '');
        const cRadius = parseFloat(searchParams?.get('radius') ?? '');
        if (Number.isFinite(cLat) && Number.isFinite(cLng)) {
          const circle = new g.maps.Circle({
            center: { lat: cLat, lng: cLng },
            radius: milesToMeters(Number.isFinite(cRadius) ? cRadius : DEFAULT_RADIUS_MILES),
            map,
            ...AREA_STYLE,
          });
          areaOverlayRef.current = circle;
          // Frame the circle when there are no result pins to frame it for us (the
          // markers effect's fitBounds takes over whenever pins exist).
          if (pins.length === 0) map.fitBounds(circle.getBounds(), 24);
        } else {
          const existing = parsePolygon(searchParams?.get('poly') ?? undefined);
          if (existing) {
            areaOverlayRef.current = new g.maps.Polygon({ paths: existing, map, ...AREA_STYLE });
          }
        }

        // City / area autocomplete → recenters + radius-searches.
        if (acInputRef.current && g.maps.places) {
          const ac = new g.maps.places.Autocomplete(acInputRef.current, {
            types: ['(cities)'],
            componentRestrictions: { country: 'us' },
            fields: ['geometry'],
          });
          ac.addListener('place_changed', () => {
            const loc = ac.getPlace()?.geometry?.location;
            if (loc) pushGeo({ lat: loc.lat(), lng: loc.lng(), radius: 12 });
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
        drawingMode: g.maps.drawing.OverlayType.CIRCLE,
        drawingControl: false,
        circleOptions: { ...AREA_STYLE },
      });
      drawingRef.current.setMap(mapRef.current);
      g.maps.event.addListener(drawingRef.current, 'circlecomplete', (circle: GMaps) => {
        areaOverlayRef.current?.setMap(null);
        areaOverlayRef.current = circle;
        drawingRef.current.setDrawingMode(null);
        setDrawing(false);
        const center = circle.getCenter();
        const radiusMiles = metersToMiles(circle.getRadius());
        if (center && radiusMiles > 0) {
          pushGeo({ lat: center.lat(), lng: center.lng(), radius: round2(radiusMiles) });
        }
      });
    } else {
      drawingRef.current.setDrawingMode(g.maps.drawing.OverlayType.CIRCLE);
    }
    setDrawing(true);
  }

  function clearArea() {
    areaOverlayRef.current?.setMap(null);
    areaOverlayRef.current = null;
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
          placeholder="Search a city or area…"
          className="min-w-[180px] flex-1 rounded-md border border-line px-3 py-1.5 text-sm text-charcoal"
          aria-label="Search a city or area on the map"
        />
        <button
          type="button"
          onClick={toggleDraw}
          className={`rounded-pill border px-3 py-1.5 text-sm font-semibold ${
            drawing ? 'border-platinum-blue bg-platinum-blue text-white' : 'border-line text-charcoal hover:border-platinum-blue'
          }`}
        >
          {drawing ? 'Click + drag to draw…' : '✏ Draw circle'}
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
