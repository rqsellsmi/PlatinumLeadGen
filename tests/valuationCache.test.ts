import { describe, it, expect, afterEach, vi } from 'vitest';
import { isLowConfidence, LOW_CONFIDENCE_THRESHOLD } from '../lib/valuation';
import { isValuationStale, VALUATION_MAX_AGE_DAYS } from '../lib/valuationCache';
import { getAttomValuation } from '../lib/attom';

const DAY_MS = 86_400_000;

describe('isLowConfidence', () => {
  it('flags scores under the threshold and nothing at or above it', () => {
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD - 1)).toBe(true);
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD + 1)).toBe(false);
    expect(isLowConfidence(0)).toBe(true);
    expect(isLowConfidence(100)).toBe(false);
  });

  it('treats a missing score as unknown, not low', () => {
    // RentCast never returns a confidence score — those estimates must not all
    // render as "uncertain".
    expect(isLowConfidence(null)).toBe(false);
    expect(isLowConfidence(undefined)).toBe(false);
  });
});

describe('isValuationStale', () => {
  it('is fresh inside the window and stale outside it', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * DAY_MS);
    expect(isValuationStale(new Date())).toBe(false);
    expect(isValuationStale(daysAgo(VALUATION_MAX_AGE_DAYS - 1))).toBe(false);
    expect(isValuationStale(daysAgo(VALUATION_MAX_AGE_DAYS + 1))).toBe(true);
  });

  it('treats missing or unparseable timestamps as stale', () => {
    // Rows written before valued_at existed re-price on first view.
    expect(isValuationStale(null)).toBe(true);
    expect(isValuationStale(undefined)).toBe(true);
    expect(isValuationStale(new Date('nonsense'))).toBe(true);
  });
});

describe('getAttomValuation', () => {
  const originalKey = process.env.ATTOM_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.ATTOM_API_KEY;
    else process.env.ATTOM_API_KEY = originalKey;
  });

  /** A trimmed attomavm/detail response with the sections we read. */
  const AVM_RESPONSE = {
    status: { code: 0, total: 1 },
    property: [
      {
        identifier: { attomId: 145678, apn: '12-34-567-890' },
        address: { oneLine: '123 Main St, Brighton, MI 48116', countrySubd: 'MI' },
        location: { latitude: '42.5295', longitude: '-83.7802', geoid: 'CO26093, ZI48116' },
        area: { subdname: 'WOODLAND SHORES', munname: 'LIVINGSTON' },
        summary: { yearbuilt: 1998, proptype: 'SFR', propsubtype: 'Single Family', propLandUse: 'SFR' },
        building: {
          rooms: { beds: 4, bathstotal: 2.5, bathsfull: 2, bathshalf: 1, roomsTotal: 8 },
          size: { livingsize: 2400, universalsize: 2400 },
          construction: { wallType: 'WOOD FRAME', roofcover: 'ASPHALT', condition: 'AVERAGE' },
          interior: { fplccount: 1, bsmtsize: 1200 },
          parking: { prkgType: 'GARAGE ATTACHED', prkgSpaces: '2' },
          summary: { levels: 2 },
        },
        lot: { lotsize1: 0.5, lotsize2: 21780, pooltype: 'POOL' },
        utilities: { heatingtype: 'FORCED AIR', coolingtype: 'CENTRAL' },
        sale: { saleTransDate: '2019-06-14T00:00:00', amount: { saleamt: 315000 } },
        avm: { amount: { value: 480000, high: 510000, low: 450000, scr: 62 }, eventDate: '2026-07-01' },
      },
    ],
  };

  function stubFetch(response: unknown, calls: string[]) {
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => response } as Response;
    });
  }

  it('calls attomavm/detail exactly once and nothing else', async () => {
    process.env.ATTOM_API_KEY = 'test-key';
    const calls: string[] = [];
    stubFetch(AVM_RESPONSE, calls);

    await getAttomValuation('123 Main St, Brighton, MI 48116');

    // The whole point of this module: one endpoint, one call per address.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/propertyapi/v1.0.0/attomavm/detail');
    expect(calls[0]).toContain('address1=123+Main+St');
    expect(calls[0]).toContain('address2=Brighton%2C+MI+48116');
    for (const path of ['salestrend', 'salescomparables', 'expandedprofile']) {
      expect(calls[0]).not.toContain(path);
    }
  });

  it('parses the valuation, the range and a low confidence score', async () => {
    process.env.ATTOM_API_KEY = 'test-key';
    stubFetch(AVM_RESPONSE, []);

    const result = await getAttomValuation('123 Main St, Brighton, MI 48116');

    expect(result.estimatedValue).toBe(480000);
    expect(result.priceRangeLow).toBe(450000);
    expect(result.priceRangeHigh).toBe(510000);
    expect(result.confidenceScore).toBe(62);
    expect(isLowConfidence(result.confidenceScore)).toBe(true); // 62 < 70 → flagged
    expect(result.latitude).toBeCloseTo(42.5295, 4);
    expect(result.attomId).toBe('145678');
    expect(result.areaGeoId).toBe('ZI48116');
    expect(result.saleHistory).toEqual([{ date: '2019-06-14', price: 315000 }]);
  });

  it('carries the full property detail from the same response', async () => {
    process.env.ATTOM_API_KEY = 'test-key';
    stubFetch(AVM_RESPONSE, []);

    const { basics, detail } = await getAttomValuation('123 Main St, Brighton, MI 48116');

    expect(basics).toMatchObject({ beds: 4, baths: 2.5, sqft: 2400, yearBuilt: 1998 });
    expect(detail).toMatchObject({
      provider: 'attom',
      formattedAddress: '123 Main St, Brighton, MI 48116',
      bathsFull: 2,
      bathsHalf: 1,
      rooms: 8,
      stories: 2,
      lotSizeSqft: 21780,
      lotSizeAcres: 0.5,
      pool: true,
      heating: 'FORCED AIR',
      cooling: 'CENTRAL',
      construction: 'WOOD FRAME',
      roof: 'ASPHALT',
      condition: 'AVERAGE',
      county: 'LIVINGSTON',
      subdivision: 'WOODLAND SHORES',
      apn: '12-34-567-890',
      garageType: 'GARAGE ATTACHED',
      garageSpaces: 2,
      lastSaleDate: '2019-06-14',
      lastSalePrice: 315000,
    });
    // The AVM endpoint returns no owner or assessment block — never invent one.
    expect(detail?.owner).toBeNull();
    expect(detail?.assessedValue).toBeNull();
    expect(detail?.taxAmount).toBeNull();
    expect(detail?.extra).toEqual(
      expect.arrayContaining([{ label: 'Fireplaces', value: '1' }]),
    );
  });

  it('returns an empty result when ATTOM cannot match the address', async () => {
    process.env.ATTOM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }) as Response);

    const result = await getAttomValuation('999 Nowhere Rd, Nowhere, MI 00000');

    expect(result.estimatedValue).toBeNull();
    expect(result.detail).toBeNull();
    expect(result.provider).toBe('attom');
  });

  it('throws on a real ATTOM failure so the caller can fall back', async () => {
    process.env.ATTOM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500 }) as Response);

    await expect(getAttomValuation('123 Main St, Brighton, MI 48116')).rejects.toThrow('ATTOM error 500');
  });
});
