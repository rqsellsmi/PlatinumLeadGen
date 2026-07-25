import Link from 'next/link';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { Card, CardHeader, CardBody, Badge, type PillTone } from '@/components/ui';
import AvmAddressForm from '@/components/admin/AvmAddressForm';
import {
  runBacktest,
  listRecentBacktests,
  getBacktest,
  backtestRowToRun,
  type BacktestRun,
  type BacktestOutcome,
} from '@/lib/avm/backtest';
import { formatLineItem } from '@/lib/avm/engine';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AVM Backtest | Admin' };

const usd = (n: number | null | undefined) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

const pct = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : '−'}${(Math.abs(n) * 100).toFixed(1)}%`;

/** Tone for an error magnitude: within 10% good, within 20% ok, else bad. */
function errTone(err: number | null | undefined): PillTone {
  if (err == null) return 'neutral';
  const a = Math.abs(err);
  if (a <= 0.1) return 'success';
  if (a <= 0.2) return 'warning';
  return 'danger';
}

const confTone: Record<string, PillTone> = { high: 'success', medium: 'info', low: 'warning' };

function compStatusLabel(status: string): string {
  if (status === 'Closed') return 'Sold';
  if (status === 'ActiveUnderContract') return 'Under contract';
  if (status === 'Pending') return 'Pending';
  if (status === 'Active') return 'Active';
  return status || 'Listed';
}
function compStatusTone(status: string): PillTone {
  if (status === 'Closed') return 'success';
  if (status === 'Pending' || status === 'ActiveUnderContract') return 'info';
  if (status === 'Active') return 'warning';
  return 'neutral';
}

/**
 * Admin glass-box AVM backtest (spec §18). Enter a sold address → we hold out its
 * most-recent sale entirely, value it from the other comps, and show our estimate
 * vs. the provider AVM vs. the actual sale price — with every comp, why it was
 * chosen, and the line-item adjustments. Each run is saved to the scoreboard below
 * so tuning the engine is legible over time. Admin-internal only (spec §19).
 */
export default async function AvmBacktestPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  await requireAdmin();

  const address = (searchParams.address ?? '').trim();
  const runId = searchParams.run ? Number(searchParams.run) : null;

  const posNum = (v?: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const flag = (v?: string) => v === '1' || v === 'on';
  const updates = {
    addedBeds: posNum(searchParams.add_beds),
    addedBaths: posNum(searchParams.add_baths),
    addedSqft: posNum(searchParams.add_sqft),
    addedGarageBays: posNum(searchParams.add_garage),
    finishedBasement: flag(searchParams.fin_basement),
    addedWalkout: flag(searchParams.add_walkout),
    addedEgress: flag(searchParams.add_egress),
    addedPool: flag(searchParams.add_pool),
  };

  // `?run=<id>` re-opens a SAVED run (rebuilt from the stored row — no re-query,
  // no provider call, no new scoreboard row). `?address=` runs a fresh backtest
  // (with any operator-entered updates folded into the subject).
  let outcome: BacktestOutcome | null = null;
  let savedAt: Date | null = null;
  if (runId != null && Number.isFinite(runId)) {
    const row = await getBacktest(runId).catch(() => null);
    if (row) {
      const rebuilt = backtestRowToRun(row);
      outcome = { ok: true, run: rebuilt.run };
      savedAt = rebuilt.savedAt;
    } else {
      outcome = { ok: false, error: 'That saved run was not found.' };
    }
  } else if (address) {
    outcome = await runBacktest(address, updates).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
  }

  const formDefault = address || (outcome && outcome.ok ? outcome.run.address : '');
  const history = await listRecentBacktests(25).catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">AVM Backtest</h1>
        <p className="mt-1 max-w-3xl text-sm text-mute-light">
          Enter an address that has <strong>already sold</strong>. We hold out its most-recent sale
          entirely (price <em>and</em> facts), value it from the other comparable sales, and compare
          our estimate to the provider AVM and to the actual sale price. Every run is saved below so
          you can re-run it after tuning the engine. Internal tool — not shown to any homeowner.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Address to test</h2>
        </CardHeader>
        <CardBody>
          <AvmAddressForm
            defaultValue={formDefault}
            updateDefaults={{
              add_beds: searchParams.add_beds ?? '',
              add_baths: searchParams.add_baths ?? '',
              add_sqft: searchParams.add_sqft ?? '',
              add_garage: searchParams.add_garage ?? '',
              fin_basement: flag(searchParams.fin_basement),
              add_walkout: flag(searchParams.add_walkout),
              add_egress: flag(searchParams.add_egress),
              add_pool: flag(searchParams.add_pool),
            }}
          />
        </CardBody>
      </Card>

      {outcome && !outcome.ok ? (
        <Card>
          <CardBody>
            <p className="text-sm text-mute">{outcome.error}</p>
          </CardBody>
        </Card>
      ) : null}

      {outcome && outcome.ok ? (
        <div className="space-y-2">
          {savedAt ? (
            <p className="text-xs text-mute-lighter">
              Viewing a saved run from {savedAt.toISOString().slice(0, 10)} — the address is prefilled above;
              click <span className="font-semibold">Run backtest</span> to refresh it against current data.
            </p>
          ) : null}
          <RunView run={outcome.run} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Scoreboard — recent runs</h2>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {history.length === 0 ? (
            <p className="text-sm text-mute">No runs yet.</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-mute-lighter">
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Actual</th>
                  <th className="py-2 pr-3">Ours</th>
                  <th className="py-2 pr-3">Our err</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Prov err</th>
                  <th className="py-2 pr-3">Conf</th>
                  <th className="py-2 pr-3">Engine</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const cErr = r.customValue != null && r.actualSalePrice ? (r.customValue - r.actualSalePrice) / r.actualSalePrice : null;
                  const pErr = r.providerValue != null && r.actualSalePrice ? (r.providerValue - r.actualSalePrice) / r.actualSalePrice : null;
                  return (
                    <tr key={r.id} className={`border-b border-line/60 ${r.id === runId ? 'bg-platinum-blue/5' : ''}`}>
                      <td className="py-2 pr-3 font-medium">
                        <Link href={`/admin/avm-backtest?run=${r.id}`} className="text-platinum-blue hover:underline">
                          {r.address}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-mute">{new Date(r.createdAt).toISOString().slice(0, 10)}</td>
                      <td className="py-2 pr-3">{usd(r.actualSalePrice)}</td>
                      <td className="py-2 pr-3">{usd(r.customValue)}</td>
                      <td className="py-2 pr-3"><Badge tone={errTone(cErr)}>{pct(cErr)}</Badge></td>
                      <td className="py-2 pr-3">{usd(r.providerValue)}</td>
                      <td className="py-2 pr-3">{r.providerValue != null ? <Badge tone={errTone(pErr)}>{pct(pErr)}</Badge> : <span className="text-mute-lighter">—</span>}</td>
                      <td className="py-2 pr-3">{r.customConfidence ? <Badge tone={confTone[r.customConfidence] ?? 'neutral'}>{r.customConfidence}</Badge> : '—'}</td>
                      <td className="py-2 pr-3 text-xs text-mute-lighter">{r.engineVersion}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function RunView({ run }: { run: BacktestRun }) {
  const { subject, result, provider, heldOut } = run;
  return (
    <div className="space-y-4">
      {/* Headline: actual vs ours vs provider */}
      <Card>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Actual sale price" value={usd(heldOut.closePrice)} sub={heldOut.closeDate ? new Date(heldOut.closeDate).toISOString().slice(0, 10) : undefined} />
            <Stat
              label="Our estimate"
              value={usd(result.value)}
              badge={<Badge tone={confTone[result.confidence] ?? 'neutral'}>{result.confidence} confidence</Badge>}
              sub={result.value != null ? `range ${usd(result.low)} – ${usd(result.high)}` : undefined}
              error={<Badge tone={errTone(run.customErrorPct)}>{pct(run.customErrorPct)} vs actual</Badge>}
            />
            <Stat
              label={`Provider AVM${provider ? ` (${provider.name})` : ''}`}
              value={usd(provider?.value)}
              sub={provider ? `range ${usd(provider.low)} – ${usd(provider.high)}` : 'not fetched this run'}
              error={provider?.value != null ? <Badge tone={errTone(run.providerErrorPct)}>{pct(run.providerErrorPct)} vs actual</Badge> : undefined}
            />
          </div>
        </CardBody>
      </Card>

      {/* Subject + provenance */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Subject property</h2>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p className="text-xs text-mute-lighter">
            Facts source: <span className="font-semibold text-mute">{subject.factsSource}</span> · comp pool: {run.compPoolSize} sales
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-mute">
            <Fact k="Beds" v={subject.beds} />
            <Fact k="Baths" v={subject.baths} />
            <Fact k="Sqft" v={subject.sqft} />
            <Fact k="Year" v={subject.yearBuilt} />
            <Fact k="Acreage" v={subject.lotSizeAcres} />
            <Fact k="Garage" v={subject.garageSpaces} />
            <Fact k="Waterfront" v={subject.waterfront == null ? null : subject.waterfront ? 'yes' : 'no'} />
            <Fact k="Frontage ft" v={subject.frontageFeet} />
            <Fact k="Basement" v={subject.basement} />
          </div>
          {run.notes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-mute-lighter">
              {run.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {/* Comps used, with reasons + adjustment grid */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Comparables used ({result.compsUsed.length})</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          {result.compsUsed.length === 0 ? (
            <p className="text-sm text-mute">No comps passed the filters — nothing to reconcile.</p>
          ) : (
            result.compsUsed.map((c) => (
              <div key={c.listingKey} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium text-charcoal">
                    <Badge tone={compStatusTone(c.status)}>{compStatusLabel(c.status)}</Badge>
                    <span>{c.address ?? '(address hidden)'}{c.city ? `, ${c.city}` : ''}</span>
                  </div>
                  <div className="text-sm text-mute">
                    {c.status === 'Closed' ? 'sold' : 'listed'} {usd(c.rawPrice)} → adjusted{' '}
                    <span className="font-semibold text-charcoal">{usd(c.adjustedPrice)}</span>
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-mute-lighter">{c.reason}</div>
                {c.lineItems.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.lineItems.map((li, i) => (
                      <span key={i} className={`rounded px-1.5 py-0.5 text-xs ${li.amount >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                        {formatLineItem(li)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-mute-lighter">No adjustments (near-identical to the subject on the fields we have).</div>
                )}
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {/* Rejected comps */}
      {result.compsRejected.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Excluded comps</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm text-mute">
              {result.compsRejected.map((r) => (
                <li key={r.listingKey}>
                  <span className="text-charcoal">{r.address ?? '(address hidden)'}</span> — {r.reason}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub, badge, error }: { label: string; value: string; sub?: string; badge?: React.ReactNode; error?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-mute-lighter">{label}</div>
      <div className="mt-1 text-2xl font-bold text-charcoal">{value}</div>
      {badge ? <div className="mt-1">{badge}</div> : null}
      {error ? <div className="mt-1">{error}</div> : null}
      {sub ? <div className="mt-1 text-xs text-mute">{sub}</div> : null}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string | number | null | undefined }) {
  if (v == null || v === '') return null;
  const display = typeof v === 'number' ? v.toLocaleString('en-US') : v;
  return (
    <span>
      <span className="text-mute-lighter">{k}:</span> <span className="font-medium text-charcoal">{display}</span>
    </span>
  );
}
