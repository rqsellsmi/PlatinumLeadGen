import type { ReactNode } from 'react';
import type { PropertyRecord } from '@/lib/valuation';
import { formatCurrency } from '@/lib/utils';

/**
 * "About this home" — the full AVM-provider property record (characteristics,
 * lot, tax/assessment, last sale, owner of record). Shown on the agent + admin
 * lead-detail pages and the admin property-lookup tool. Renders nothing when
 * there's no record. Owner data is public record (Michigan) and only appears on
 * these authenticated internal views.
 */
export default function PropertyDetails({
  record,
  fetchedAt,
  provider,
  raw,
  showRaw = false,
}: {
  record: PropertyRecord | null;
  fetchedAt?: Date | null;
  provider?: string | null;
  raw?: unknown;
  showRaw?: boolean;
}) {
  if (!record) return null;

  const fmtNum = (n: number | null, suffix = '') => (n != null ? `${n.toLocaleString()}${suffix}` : null);
  const baths =
    record.bathsTotal != null
      ? String(record.bathsTotal)
      : [record.bathsFull, record.bathsHalf].some((v) => v != null)
        ? `${record.bathsFull ?? 0} full / ${record.bathsHalf ?? 0} half`
        : null;
  const lot =
    record.lotSizeSqft != null
      ? `${record.lotSizeSqft.toLocaleString()} sqft${record.lotSizeAcres != null ? ` (${record.lotSizeAcres} ac)` : ''}`
      : record.lotSizeAcres != null
        ? `${record.lotSizeAcres} ac`
        : null;

  const facts: [string, ReactNode][] = [
    ['Property type', record.propertyType],
    ['Land use', record.propertyUse !== record.propertyType ? record.propertyUse : null],
    ['Year built', record.yearBuilt != null ? String(record.yearBuilt) : null],
    ['Beds', record.beds != null ? String(record.beds) : null],
    ['Baths', baths],
    ['Living area', fmtNum(record.sqft, ' sqft')],
    ['Lot size', lot],
    ['Stories', record.stories != null ? String(record.stories) : null],
    ['Rooms', record.rooms != null ? String(record.rooms) : null],
    ['Units', record.units != null ? String(record.units) : null],
    ['Garage', [record.garageType, record.garageSpaces != null ? `${record.garageSpaces} spaces` : null].filter(Boolean).join(' · ') || null],
    ['Pool', record.pool ? 'Yes' : null],
    ['Heating', record.heating],
    ['Cooling', record.cooling],
    ['Construction', record.construction],
    ['Roof', record.roof],
    ['Condition', record.condition],
    ['County', record.county],
    ['Subdivision', record.subdivision],
    ['Zoning', record.zoning],
    ['APN / Parcel', record.apn],
    ...record.extra.map((e) => [e.label, e.value] as [string, ReactNode]),
  ];
  const shownFacts = facts.filter(([, v]) => v != null && v !== '');

  const money: [string, ReactNode][] = [
    ['Last sale', record.lastSalePrice != null || record.lastSaleDate != null
      ? `${record.lastSalePrice != null ? formatCurrency(record.lastSalePrice) : '—'}${record.lastSaleDate ? ` · ${record.lastSaleDate}` : ''}`
      : null],
    ['Assessed value', record.assessedValue != null ? formatCurrency(record.assessedValue) : null],
    ['Market value', record.marketValue != null ? formatCurrency(record.marketValue) : null],
    ['Assessed land', record.assessedLand != null ? formatCurrency(record.assessedLand) : null],
    ['Assessed improvements', record.assessedImprovements != null ? formatCurrency(record.assessedImprovements) : null],
    ['Property tax', record.taxAmount != null
      ? `${formatCurrency(record.taxAmount)}${record.taxYear != null ? ` (${record.taxYear})` : ''}`
      : null],
  ];
  const shownMoney = money.filter(([, v]) => v != null && v !== '');

  return (
    <div className="rounded-card border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="font-bold text-charcoal">About this home</h2>
        <span className="text-[11px] text-mute-lighter">
          {(provider ?? record.provider)?.toUpperCase()} property record
          {fetchedAt ? ` · as of ${fetchedAt.toISOString().slice(0, 10)}` : ''}
        </span>
      </div>

      <div className="space-y-6 px-5 py-5">
        {shownFacts.length ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {shownFacts.map(([label, value]) => (
              <Row key={label} label={label} value={value} />
            ))}
          </dl>
        ) : null}

        {shownMoney.length ? (
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              Tax &amp; sale history
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {shownMoney.map(([label, value]) => (
                <Row key={label} label={label} value={value} />
              ))}
            </dl>
          </div>
        ) : null}

        {record.owner ? (
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              Owner of record <span className="font-medium normal-case text-mute-lighter">(public record)</span>
            </p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {record.owner.names.length ? (
                <Row label="Owner(s)" value={record.owner.names.join(', ')} />
              ) : null}
              {record.owner.ownerOccupied != null ? (
                <Row label="Occupancy" value={record.owner.ownerOccupied ? 'Owner-occupied' : 'Absentee owner'} />
              ) : null}
              {record.owner.mailingAddress ? (
                <Row label="Mailing address" value={record.owner.mailingAddress} />
              ) : null}
            </dl>
          </div>
        ) : null}

        {showRaw && raw ? (
          <details className="text-xs text-mute-light">
            <summary className="cursor-pointer font-semibold text-platinum-blue">Raw provider data</summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-cream p-3 text-[11px] leading-relaxed">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">{label}</dt>
      <dd className="mt-0.5 text-charcoal">{value}</dd>
    </div>
  );
}
