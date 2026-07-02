import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, agents, leads, leadOffers, closings, guides } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { resolveDatabaseUrl, DATABASE_URL_CANDIDATES } from '@/lib/dbUrl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLES: { label: string; table: any }[] = [
  { label: 'locations', table: locations },
  { label: 'agents', table: agents },
  { label: 'leads', table: leads },
  { label: 'lead_offers', table: leadOffers },
  { label: 'closings', table: closings },
  { label: 'guides', table: guides },
];

export const dynamic = 'force-dynamic';

/**
 * Admin-only connection diagnostic. Shows which env var supplied the DB
 * connection, the host/database it points at (credentials masked), and live
 * row counts — so a "seeded but empty" mystery can be pinned to the exact
 * database the deployment is actually reading. Safe to delete once resolved.
 */
export default async function AdminDebugPage({
  searchParams,
}: {
  searchParams: { attom?: string };
}) {
  await requireAdmin();

  const probeAddress = (searchParams.attom ?? '').trim();
  let attomProbe: Awaited<ReturnType<typeof import('@/lib/attom').probeAttom>> | null = null;
  let attomProbeError = '';
  if (probeAddress) {
    try {
      const { probeAttom } = await import('@/lib/attom');
      attomProbe = await probeAttom(probeAddress);
    } catch (e) {
      attomProbeError = e instanceof Error ? e.message : 'probe failed';
    }
  }

  const activeVar =
    DATABASE_URL_CANDIDATES.find((k) => process.env[k] && process.env[k]!.trim()) ?? '(none)';

  let host = '(unparseable)';
  let database = '';
  try {
    const u = new URL(resolveDatabaseUrl());
    host = u.host;
    database = u.pathname.replace(/^\//, '');
  } catch {
    /* ignore */
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function count(table: any): Promise<string> {
    try {
      const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table);
      const n = rows[0]?.n;
      return n != null ? String(Number(n)) : '—';
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : 'unknown'}`;
    }
  }

  const counts = await Promise.all(
    TABLES.map(async ({ label, table }) => ({ t: label, n: await count(table) })),
  );

  let locRows: { slug: string; name: string; isActive: boolean }[] = [];
  let locError = '';
  try {
    locRows = await db
      .select({ slug: locations.slug, name: locations.name, isActive: locations.isActive })
      .from(locations)
      .limit(50);
  } catch (e) {
    locError = e instanceof Error ? e.message : 'unknown';
  }
  const activeCount = locRows.filter((l) => l.isActive).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Connection diagnostic</h1>
        <p className="text-sm text-mute">
          What database this deployment is actually reading. Credentials are not shown.
        </p>
      </div>

      <div className="rounded-card border border-line bg-white p-5 text-sm">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              Connection var used
            </dt>
            <dd className="font-mono text-charcoal">{activeVar}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              Database host
            </dt>
            <dd className="break-all font-mono text-charcoal">{host}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              Database name
            </dt>
            <dd className="font-mono text-charcoal">{database || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              APP_DATABASE_URL set?
            </dt>
            <dd className="font-mono text-charcoal">
              {process.env.APP_DATABASE_URL && process.env.APP_DATABASE_URL.trim() ? 'yes' : 'no'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
              <th className="px-5 py-3 text-left">Table</th>
              <th className="px-5 py-3 text-left">Row count</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.t} className="border-b border-line-hair last:border-0">
                <td className="px-5 py-3 font-mono text-charcoal">{c.t}</td>
                <td className="px-5 py-3 font-mono text-charcoal">{c.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-line bg-white p-5">
        <p className="mb-3 font-bold text-charcoal">
          Locations — {activeCount} of {locRows.length} active
          <span className="ml-2 font-normal text-mute-light">
            (only active cities appear on public pages)
          </span>
        </p>
        {locError ? (
          <p className="font-mono text-sm text-platinum-red">error: {locError}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {locRows.map((l) => (
              <li key={l.slug} className="flex items-center gap-3 font-mono">
                <span className={l.isActive ? 'text-success' : 'text-platinum-red'}>
                  {l.isActive ? 'active' : 'INACTIVE'}
                </span>
                <span className="text-charcoal">{l.slug}</span>
                <span className="text-mute-light">{l.name}</span>
              </li>
            ))}
            {locRows.length === 0 ? <li className="text-mute">No locations.</li> : null}
          </ul>
        )}
      </div>

      {/* ATTOM probe — inspect a live ATTOM response to see which fields exist. */}
      <div className="rounded-card border border-line bg-white p-5">
        <p className="mb-1 font-bold text-charcoal">ATTOM probe</p>
        <p className="mb-3 text-sm text-mute-light">
          Enter an address to call the live ATTOM AVM endpoint and see what it returns —
          whether it includes a property id (comps) and area geo id (market trends).
          Requires ATTOM_API_KEY set in this environment.
        </p>
        <form method="get" className="flex flex-wrap gap-2">
          <input
            type="text"
            name="attom"
            defaultValue={probeAddress}
            placeholder="123 Main St, Brighton, MI 48116"
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-charcoal px-4 py-2 text-sm font-bold text-white"
          >
            Probe
          </button>
        </form>

        {attomProbeError ? (
          <p className="mt-3 font-mono text-sm text-platinum-red">error: {attomProbeError}</p>
        ) : null}

        {attomProbe ? (
          <div className="mt-4 space-y-3 text-sm">
            <ul className="grid grid-cols-1 gap-1 font-mono sm:grid-cols-2">
              <li>HTTP status: <span className="text-charcoal">{String(attomProbe.status)}</span></li>
              <li>error: <span className="text-charcoal">{attomProbe.error ?? 'none'}</span></li>
              <li>
                estimate:{' '}
                <span className="text-charcoal">
                  {attomProbe.normalized?.estimatedValue ?? '—'}
                </span>
              </li>
              <li>
                confidence:{' '}
                <span className="text-charcoal">
                  {attomProbe.normalized?.confidenceScore ?? '—'}
                </span>
              </li>
              <li>
                attomId (comps):{' '}
                <span className={attomProbe.normalized?.attomId ? 'text-success' : 'text-platinum-red'}>
                  {attomProbe.normalized?.attomId ?? 'MISSING'}
                </span>
              </li>
              <li>
                areaGeoId (trends):{' '}
                <span className={attomProbe.normalized?.areaGeoId ? 'text-success' : 'text-platinum-red'}>
                  {attomProbe.normalized?.areaGeoId ?? 'MISSING'}
                </span>
              </li>
              <li>trends resolved: <span className="text-charcoal">{attomProbe.trends ? 'yes' : 'no'}</span></li>
              <li>comps found: <span className="text-charcoal">{attomProbe.compsCount}</span></li>
            </ul>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
                Raw property keys
              </p>
              <p className="break-all font-mono text-xs text-charcoal">
                {attomProbe.rawKeys.join(', ') || '(none)'}
              </p>
            </div>
            <details>
              <summary className="cursor-pointer text-mute">
                identifier / area / location / avm (raw JSON)
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-offwhite p-3 text-xs">
                {JSON.stringify(
                  {
                    identifier: attomProbe.identifier,
                    area: attomProbe.area,
                    location: attomProbe.location,
                    avm: attomProbe.avm,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            {attomProbe.trendDebug ? (
              <details>
                <summary className="cursor-pointer text-mute">
                  sales-trend raw response (status {String(attomProbe.trendDebug.status)})
                </summary>
                <p className="mt-1 break-all font-mono text-[11px] text-mute-light">
                  {attomProbe.trendDebug.url}
                </p>
                <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-offwhite p-3 text-xs">
                  {attomProbe.trendDebug.body || '(empty)'}
                </pre>
              </details>
            ) : null}
            {attomProbe.compsDebug ? (
              <details>
                <summary className="cursor-pointer text-mute">
                  sales-comparables raw response (status {String(attomProbe.compsDebug.status)})
                </summary>
                <p className="mt-1 break-all font-mono text-[11px] text-mute-light">
                  {attomProbe.compsDebug.url}
                </p>
                <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-offwhite p-3 text-xs">
                  {attomProbe.compsDebug.body || '(empty)'}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
