/**
 * Ambient typing for the Google Maps Places script we load at runtime via a
 * <Script> tag (not the npm SDK), so `window.google.maps.places.Autocomplete`
 * is typed for every consumer.
 *
 * This lived inside a since-removed valuation component; it is shared
 * infrastructure — HeroValuation and the exit-intent overlay both read
 * `window.google` — so it belongs in a neutral ambient file, not a component.
 */
import type { PlaceAddressComponent } from '@/lib/placeComponents';

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: Record<string, unknown>,
          ) => {
            addListener: (event: string, handler: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
              address_components?: PlaceAddressComponent[];
            };
          };
        };
      };
    };
  }
}

export {};
