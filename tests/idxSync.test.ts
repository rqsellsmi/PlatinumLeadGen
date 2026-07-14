import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseOfficeKeys,
  officeFieldClauses,
  serializeWaterfrontFeatures,
  serializeEnumList,
  buildAddress,
  computeBaths,
  extractPhotos,
  mapRealcompListing,
  cleanCity,
  SELECT_FIELDS,
} from '../lib/idxSync';

describe('office keys', () => {
  beforeEach(() => {
    process.env.REALCOMP_OFFICE_KEYS = '111, 222 ,333,';
  });

  it('parses a comma list, trims, drops blanks', () => {
    expect(parseOfficeKeys()).toEqual(['111', '222', '333']);
  });

  it('builds one quoted in() clause per office field (URL-length safe)', () => {
    const clauses = officeFieldClauses();
    expect(clauses).toEqual([
      "ListOfficeMlsId in ('111','222','333')",
      "BuyerOfficeMlsId in ('111','222','333')",
      "CoListOfficeMlsId in ('111','222','333')",
      "CoBuyerOfficeMlsId in ('111','222','333')",
    ]);
  });

  it('returns [] when unset', () => {
    process.env.REALCOMP_OFFICE_KEYS = '';
    expect(officeFieldClauses()).toEqual([]);
  });
});

describe('serializeWaterfrontFeatures', () => {
  it('serializes an enum multi-value array with spacing', () => {
    expect(serializeWaterfrontFeatures(['LakeFront', 'Dock', 'SandyBottom'])).toBe(
      'Lake Front, Dock, Sandy Bottom',
    );
  });
  it('handles a single value', () => {
    expect(serializeWaterfrontFeatures('LakeFront')).toBe('Lake Front');
  });
  it('returns null for empty/missing', () => {
    expect(serializeWaterfrontFeatures(null)).toBeNull();
    expect(serializeWaterfrontFeatures([])).toBeNull();
  });
});

describe('buildAddress', () => {
  it('concatenates street parts', () => {
    expect(
      buildAddress({ StreetNumber: '123', StreetName: 'Main', StreetSuffix: 'St' }),
    ).toBe('123 Main St');
  });
  it('appends a unit number', () => {
    expect(
      buildAddress({ StreetNumber: '5', StreetName: 'Oak', StreetSuffix: 'Ave', UnitNumber: '2B' }),
    ).toBe('5 Oak Ave #2B');
  });
  it('falls back to UnparsedAddress', () => {
    expect(buildAddress({ UnparsedAddress: '9 Elm Ct, Brighton, MI' })).toBe('9 Elm Ct, Brighton, MI');
  });
});

describe('cleanCity', () => {
  it('prefers OriginalPostalCity (the clean mailing city)', () => {
    expect(
      cleanCity({
        City: 'SturgisCity_StJoseph',
        PostalCity: 'Sturgis_StJoseph',
        OriginalCity: 'Sturgis City',
        OriginalPostalCity: 'Sturgis',
      }),
    ).toBe('Sturgis');
  });
  it('falls back to OriginalCity when OriginalPostalCity is missing', () => {
    expect(cleanCity({ OriginalCity: 'Lockport Twp' })).toBe('Lockport Twp');
  });
  it('de-enum-ifies PostalCity as a last resort', () => {
    expect(cleanCity({ PostalCity: 'ThreeRivers_StJoseph' })).toBe('Three Rivers');
  });
  it('returns null with nothing', () => {
    expect(cleanCity({})).toBeNull();
  });
});

describe('computeBaths', () => {
  it('prefers full + 0.5*half', () => {
    expect(computeBaths({ BathroomsFull: 2, BathroomsHalf: 1 })).toBe(2.5);
  });
  it('falls back to BathroomsTotalInteger', () => {
    expect(computeBaths({ BathroomsTotalInteger: 3 })).toBe(3);
  });
  it('returns null with nothing', () => {
    expect(computeBaths({})).toBeNull();
  });
});

describe('extractPhotos', () => {
  it('sorts by Order and drops urlless entries', () => {
    const photos = extractPhotos({
      Media: [
        { MediaURL: 'b.jpg', Order: 2 },
        { MediaURL: 'a.jpg', Order: 1 },
        { Order: 3 }, // no url — dropped
      ],
    });
    expect(photos.map((p) => p.url)).toEqual(['a.jpg', 'b.jpg']);
  });
});

describe('mapRealcompListing', () => {
  beforeEach(() => {
    process.env.REALCOMP_OFFICE_KEYS = '630843964049,814805080452';
  });

  it('maps core fields and computes isOfficeListing (buyer side)', () => {
    const row = mapRealcompListing({
      ListingKey: 'RC1',
      ListingId: 'MLS100',
      StandardStatus: 'Closed',
      BuyerOfficeMlsId: '814805080452',
      ListOfficeMlsId: '999',
      ListPrice: '350000',
      ClosePrice: '360000',
      CloseDate: '2025-03-01T00:00:00Z',
      BathroomsFull: 2,
      BathroomsHalf: 1,
      WaterfrontFeatures: ['LakeFront', 'Dock'],
      Media: [{ MediaURL: 'p1.jpg', Order: 0 }],
      ModificationTimestamp: '2025-03-02T10:00:00Z',
    })!;
    expect(row.listingKey).toBe('RC1');
    expect(row.mlsNumber).toBe('MLS100');
    expect(row.isOfficeListing).toBe(true);
    expect(row.listPrice).toBe(350000);
    expect(row.closePrice).toBe(360000);
    expect(row.bathsTotal).toBe(2.5);
    expect(row.waterfrontFeatures).toBe('Lake Front, Dock');
    expect(row.photoUrl).toBe('p1.jpg');
    expect(row.standardStatus).toBe('Closed');
  });

  it('isOfficeListing is false when no office key matches', () => {
    const row = mapRealcompListing({
      ListingKey: 'RC2',
      StandardStatus: 'Active',
      ListOfficeMlsId: '123',
      BuyerOfficeMlsId: '456',
      ModificationTimestamp: '2025-01-01T00:00:00Z',
    })!;
    expect(row.isOfficeListing).toBe(false);
  });

  it('returns null when ListingKey is missing', () => {
    expect(mapRealcompListing({ StandardStatus: 'Active' })).toBeNull();
  });

  it('maps the buyer-relevant detail fields (0021)', () => {
    const row = mapRealcompListing({
      ListingKey: 'RC3',
      StandardStatus: 'Closed',
      ModificationTimestamp: '2025-03-02T10:00:00Z',
      Heating: ['ForcedAir'],
      Cooling: ['CentralAir'],
      FireplacesTotal: '1',
      FireplaceFeatures: ['Gas'],
      LaundryFeatures: ['MainLevel'],
      AssociationFee: '260',
      AssociationFeeFrequency: 'Monthly',
      TaxAnnualAmount: '4510.5',
      TaxYear: '2025',
      WaterSource: ['Public'],
      Sewer: ['PublicSewer'],
      Appliances: ['Dishwasher', 'Microwave', 'Dishwasher'],
      Levels: 'One',
      StoriesTotal: '1',
    })!;
    expect(row.heating).toBe('Forced Air');
    expect(row.cooling).toBe('Central Air');
    expect(row.fireplacesTotal).toBe(1);
    expect(row.fireplaceFeatures).toBe('Gas');
    expect(row.laundryFeatures).toBe('Main Level');
    expect(row.associationFee).toBe(260);
    expect(row.associationFeeFrequency).toBe('Monthly');
    expect(row.taxAnnualAmount).toBe(4510.5);
    expect(row.taxYear).toBe(2025);
    expect(row.waterSource).toBe('Public');
    expect(row.sewer).toBe('Public Sewer');
    // Deduplicated enum list.
    expect(row.appliances).toBe('Dishwasher, Microwave');
    expect(row.storiesTotal).toBe(1);
  });
});

describe('serializeEnumList', () => {
  it('spaces camelCase and joins with commas', () => {
    expect(serializeEnumList(['ForcedAir', 'CentralAir'])).toBe('Forced Air, Central Air');
  });
  it('accepts a single scalar value', () => {
    expect(serializeEnumList('Public')).toBe('Public');
  });
  it('dedupes and drops blanks', () => {
    expect(serializeEnumList(['Gas', 'Gas', '', null])).toBe('Gas');
  });
  it('returns null for empty / nullish input', () => {
    expect(serializeEnumList(null)).toBeNull();
    expect(serializeEnumList([])).toBeNull();
  });
});

describe('SELECT_FIELDS', () => {
  it('requests the new buyer-relevant fields from the feed', () => {
    for (const f of ['Heating', 'Cooling', 'AssociationFee', 'TaxAnnualAmount', 'LaundryFeatures']) {
      expect(SELECT_FIELDS).toContain(f);
    }
  });
});
