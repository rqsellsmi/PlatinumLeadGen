/**
 * Single-load Google Maps JS API loader (client only).
 *
 * The Maps JS API can only be loaded ONCE per page; loading it twice with
 * different `libraries` sets is flaky (the second load is a no-op and its extra
 * libraries may be missing). Several components need Maps — the valuation
 * autocomplete (`places`) and the buyer search map (`places,drawing,geometry`).
 * Route them ALL through this singleton so exactly one script tag loads the
 * superset of libraries, and everyone awaits the same promise.
 */

// Load the superset every consumer might need, so a single tag satisfies all.
export const MAPS_LIBRARIES = 'places,drawing,geometry';

let loadPromise: Promise<void> | null = null;

/** Resolve when `window.google.maps` (with all our libraries) is ready. */
export function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const w = window as unknown as { google?: { maps?: unknown } };
  if (w.google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set'));

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps]');
    if (existing) {
      if ((window as unknown as { google?: { maps?: unknown } }).google?.maps) {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      }
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=${MAPS_LIBRARIES}`;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-google-maps', '1');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return loadPromise;
}
