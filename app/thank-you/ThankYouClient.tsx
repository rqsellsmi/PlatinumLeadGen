'use client';

import * as React from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardBody } from '@/components/ui';
import { dataLayerPush } from '@/lib/clientAnalytics';
import { formatCurrency, formatMonthYear } from '@/lib/utils';
import type { HomeRecentSale } from '@/lib/queries';
import type { MarketStat } from '@/drizzle/schema';
import AppointmentForm from './AppointmentForm';

const STEPS = [
  'A local RE/MAX Platinum expert reviews your home and recent comparable sales.',
  'They prepare your personalized market report and recommended listing price.',
  'You get a call to walk through the numbers — no obligation.',
];

const CONDITIONS = [
  { label: 'Original / as-is', hint: 'Dated finishes', factor: 0.97 },
  { label: 'Average', hint: 'Well maintained', factor: 1.0 },
  { label: 'Move-in ready', hint: 'Some updates', factor: 1.03 },
  { label: 'Renovated', hint: 'Recently remodeled', factor: 1.06 },
];

function withinOfferWindow(): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
  return hour >= 7 && hour < 20;
}

function num(key: string): number | null {
  const v = sessionStorage.getItem(key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function ThankYouClient({
  comps,
  snapshot,
  cityName,
}: {
  comps: HomeRecentSale[];
  snapshot: MarketStat | null;
  cityName: string;
}) {
  const params = useSearchParams();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [leadId, setLeadId] = React.useState<number | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [responseMsg, setResponseMsg] = React.useState('within 3 hours');
  const [condition, setCondition] = React.useState(1); // "Average"
  const [range, setRange] = React.useState<{ low: number; high: number; est: number | null } | null>(
    null,
  );

  React.useEffect(() => {
    const type = params.get('type') ?? 'valuation';
    const city = params.get('city') ?? '';
    const variant = params.get('variant') ?? 'seo';
    const em = sessionStorage.getItem('lead_email') ?? '';
    const ph = sessionStorage.getItem('lead_phone') ?? '';
    const lid = sessionStorage.getItem('lead_id');
    setName(sessionStorage.getItem('lead_name') ?? '');
    setAddress(sessionStorage.getItem('lead_address') ?? '');
    setPhone(ph);
    setEmail(em);
    setLeadId(lid ? Number(lid) : null);
    setResponseMsg(withinOfferWindow() ? 'within 3 hours' : 'first thing tomorrow morning');

    const low = num('lead_range_low');
    const high = num('lead_range_high');
    if (low != null && high != null) setRange({ low, high, est: num('lead_est_value') });

    dataLayerPush('lead_conversion', {
      lead_type: type,
      city,
      page_variant: variant,
      value: 50,
      email: em,
      phone: ph,
    });
  }, [params]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const factor = CONDITIONS[condition].factor;
  const firstName = name.split(' ')[0] || '';
  const topComps = comps.slice(0, 3);

  return (
    <>
      {range ? (
        <section>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-platinum-red">
            Home valuation report{firstName ? ` · prepared for ${firstName}` : ''}
          </p>
          {address ? (
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-charcoal sm:text-3xl">
              {address}
            </h1>
          ) : null}

          {/* Estimated value card */}
          <div className="mt-5 rounded-2xl bg-charcoal p-6 text-white sm:p-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mute-lighter">
              Estimated market value
            </p>
            <p className="mt-1 font-numeric text-4xl font-bold leading-none sm:text-5xl">
              {formatCurrency(Math.round(range.low * factor))} –{' '}
              {formatCurrency(Math.round(range.high * factor))}
            </p>
            {range.est != null ? (
              <p className="mt-2 text-sm text-mute-lighter">
                Most likely{' '}
                <span className="font-bold text-white">
                  {formatCurrency(Math.round(range.est * factor))}
                </span>
                {topComps.length ? ` · based on ${comps.length} comparable sales` : ''}
              </p>
            ) : null}
            <div className="relative mt-5 h-1.5 rounded-pill bg-white/20">
              <div className="absolute inset-y-0 left-0 right-0 rounded-pill bg-gradient-to-r from-white/30 via-platinum-red to-white/30" />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-mute-lighter">
              <span>{formatCurrency(Math.round(range.low * factor))}</span>
              <span>{formatCurrency(Math.round(range.high * factor))}</span>
            </div>
          </div>

          {/* Refine by condition */}
          <div className="mt-5 rounded-card border border-line bg-white p-5">
            <p className="font-bold text-charcoal">Refine your estimate</p>
            <p className="text-sm text-mute-light">
              The range above assumes average condition. Tell us more and we&apos;ll sharpen it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CONDITIONS.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setCondition(i)}
                  className={`rounded-lg border px-3.5 py-2 text-left text-sm transition-colors ${
                    condition === i
                      ? 'border-platinum-red bg-danger-bg text-charcoal'
                      : 'border-line bg-white text-charcoal hover:border-charcoal/30'
                  }`}
                >
                  <span className="block font-bold">{c.label}</span>
                  <span className="block text-xs text-mute-light">{c.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm">
              <span className="text-mute">Adjusted estimate: </span>
              <span className="font-bold text-platinum-red">
                {formatCurrency(Math.round(range.low * factor))} –{' '}
                {formatCurrency(Math.round(range.high * factor))}
              </span>
            </p>
          </div>

          {/* Comps */}
          {topComps.length > 0 ? (
            <div className="mt-5 rounded-card border border-line bg-white p-5">
              <p className="font-bold text-charcoal">How we calculated this</p>
              <p className="text-sm text-mute-light">
                Built from recent {cityName || 'local'} sales by RE/MAX Platinum.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {topComps.map((c) => (
                  <div key={c.id} className="overflow-hidden rounded-lg border border-line">
                    <div className="relative h-24 bg-line-hair">
                      {c.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.photoUrl} alt={c.address} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="p-3">
                      <p className="font-numeric text-lg font-bold text-charcoal">
                        {formatCurrency(c.soldPrice)}
                      </p>
                      <p className="truncate text-xs text-mute-light">{c.address}</p>
                      <p className="mt-1 text-[11px] font-semibold text-success">
                        {c.daysOnMarket != null ? `Sold ${c.daysOnMarket} days` : 'Sold'}
                        {c.closeDate ? ` · ${formatMonthYear(c.closeDate)}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Market snapshot */}
          {snapshot ? (
            <div className="mt-5 rounded-card border border-line bg-white p-5">
              <p className="font-bold text-charcoal">{cityName || 'Market'} snapshot</p>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {snapshot.daysToSell != null ? (
                  <Stat label="Avg days on market" value={String(snapshot.daysToSell)} />
                ) : null}
                {snapshot.percentOfListPrice != null ? (
                  <Stat label="List-to-sale ratio" value={`${snapshot.percentOfListPrice}%`} />
                ) : null}
                {snapshot.percentAboveList != null ? (
                  <Stat label="Sold above asking" value={`${snapshot.percentAboveList}%`} />
                ) : null}
                {snapshot.homesSold != null ? (
                  <Stat label="Homes sold (12 mo)" value={String(snapshot.homesSold)} />
                ) : null}
              </dl>
            </div>
          ) : null}

          <div className="mt-8 rounded-lg border border-line bg-cream px-4 py-3 text-center text-sm text-mute">
            <span className="font-semibold text-charcoal">A local expert will call you</span>{' '}
            {responseMsg} to refine this and walk you through your options.
          </div>
        </section>
      ) : (
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success text-3xl text-white">
            ✓
          </div>
          <h1 className="mt-6 text-3xl font-bold text-charcoal">Thank you!</h1>
          <p className="mt-4 text-lg text-mute">
            We&apos;ve received your request. A local RE/MAX Platinum expert is reviewing your
            information now.
          </p>
          <p className="mt-4 rounded-lg border border-line bg-cream px-4 py-3 text-sm text-mute">
            <span className="font-semibold text-charcoal">Expected response time:</span> {responseMsg}.
          </p>
        </div>
      )}

      <div className="mt-12">
        <h2 className="text-center text-xl font-bold text-charcoal">What happens next</h2>
        <ol className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={i} className="rounded-card border border-line bg-white p-5 text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-charcoal font-numeric text-sm font-bold text-white">
                {i + 1}
              </div>
              <p className="mt-3 text-sm text-mute">{s}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-12">
        <AppointmentForm initialName={name} initialPhone={phone} initialEmail={email} leadId={leadId} />
      </div>

      <div className="mt-10">
        <Card>
          <CardBody className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-bold text-charcoal">Know a neighbor thinking of selling?</p>
              <p className="text-sm text-mute">Share this free home value tool.</p>
            </div>
            <Button variant="secondary" onClick={copyLink}>
              {copied ? 'Link copied!' : 'Copy link'}
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="font-numeric text-2xl font-bold text-charcoal">{value}</dd>
      <dt className="text-xs text-mute-light">{label}</dt>
    </div>
  );
}
