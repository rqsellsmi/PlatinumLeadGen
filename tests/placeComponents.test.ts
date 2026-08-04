/**
 * Places address_components parsing (P0.4 / D22).
 *
 * These fields are what make `leads.property_state` real, which is what gives
 * the out-of-state routing gate something to act on.
 */
import { describe, it, expect } from 'vitest';
import { parsePlaceComponents } from '../lib/placeComponents';

const brighton = [
  { long_name: '6870', short_name: '6870', types: ['street_number'] },
  { long_name: 'Grand River Avenue', short_name: 'Grand River Ave', types: ['route'] },
  { long_name: 'Brighton', short_name: 'Brighton', types: ['locality', 'political'] },
  {
    long_name: 'Michigan',
    short_name: 'MI',
    types: ['administrative_area_level_1', 'political'],
  },
  { long_name: '48114', short_name: '48114', types: ['postal_code'] },
];

describe('parsePlaceComponents', () => {
  it('pulls city, two-letter state and ZIP', () => {
    expect(parsePlaceComponents(brighton)).toEqual({
      city: 'Brighton',
      state: 'MI',
      zip: '48114',
    });
  });

  it('uses short_name for the state, not the full name', () => {
    // 'Michigan' would not compare against SERVICE_AREA_STATE.
    expect(parsePlaceComponents(brighton).state).toBe('MI');
  });

  it('falls back to sublocality when Places omits locality', () => {
    // Unincorporated areas and some Michigan townships return no locality.
    const township = [
      { long_name: 'Genoa Township', short_name: 'Genoa Twp', types: ['sublocality', 'political'] },
      { long_name: 'Michigan', short_name: 'MI', types: ['administrative_area_level_1'] },
    ];
    expect(parsePlaceComponents(township).city).toBe('Genoa Township');
    expect(parsePlaceComponents(township).state).toBe('MI');
  });

  it('falls back to administrative_area_level_3 as a last resort', () => {
    const aal3 = [
      { long_name: 'Hartland', short_name: 'Hartland', types: ['administrative_area_level_3'] },
      { long_name: 'Michigan', short_name: 'MI', types: ['administrative_area_level_1'] },
    ];
    expect(parsePlaceComponents(aal3).city).toBe('Hartland');
  });

  it('returns nulls rather than throwing on missing or malformed input', () => {
    const empty = { city: null, state: null, zip: null };
    expect(parsePlaceComponents(null)).toEqual(empty);
    expect(parsePlaceComponents(undefined)).toEqual(empty);
    expect(parsePlaceComponents([])).toEqual(empty);
    expect(parsePlaceComponents([{ types: ['route'] }])).toEqual(empty);
    expect(parsePlaceComponents([{ long_name: 'x' }])).toEqual(empty);
  });

  it('treats a blank component value as absent', () => {
    expect(
      parsePlaceComponents([{ long_name: '  ', short_name: '  ', types: ['locality'] }]).city,
    ).toBeNull();
  });
});
