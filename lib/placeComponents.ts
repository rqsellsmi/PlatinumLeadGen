/**
 * Extract city / state / ZIP from a Google Places result (P0.4, D22).
 *
 * The forms have always posted only the formatted address and coordinates, so
 * `leads.property_city` and `leads.property_state` were NULL on every
 * organically-submitted lead — which made an out-of-state gate keyed on
 * `propertyState` a no-op, and left agents without the city on lead detail.
 *
 * Asking Places for `address_components` costs nothing extra (it is part of the
 * same Place result, in the same billing SKU as `formatted_address`) and gives
 * the real values instead of a parsed guess.
 *
 * `lib/coverage.deriveStateFromAddress` remains as the fallback for leads
 * captured before this shipped, and for the admin/webhook paths that never had
 * a Places result at all.
 *
 * Pure and relative-imported so it is testable (lessons-learned §17). The type
 * is structural rather than `google.maps.*` so this module carries no
 * dependency on the Maps typings.
 */

export interface PlaceAddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

export interface ParsedPlaceLocation {
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Pull the mailing city, two-letter state and ZIP out of Places'
 * `address_components`.
 *
 * `locality` is the usual city, but Places omits it for addresses in
 * unincorporated areas and some townships — where it returns only
 * `sublocality` or `administrative_area_level_3`. Falling back through those
 * keeps a Michigan township address from losing its city entirely.
 */
export function parsePlaceComponents(
  components: PlaceAddressComponent[] | null | undefined,
): ParsedPlaceLocation {
  const empty: ParsedPlaceLocation = { city: null, state: null, zip: null };
  if (!Array.isArray(components)) return empty;

  const find = (type: string) => components.find((c) => c.types?.includes(type));

  const cityComponent =
    find('locality') ?? find('sublocality') ?? find('administrative_area_level_3');
  const stateComponent = find('administrative_area_level_1');
  const zipComponent = find('postal_code');

  return {
    city: cityComponent?.long_name?.trim() || null,
    // short_name is the two-letter code ("MI"); long_name is "Michigan".
    state: stateComponent?.short_name?.trim().toUpperCase() || null,
    zip: zipComponent?.long_name?.trim() || null,
  };
}
