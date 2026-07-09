import type { ReactNode } from 'react';
import { Card, CardHeader, CardBody, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import LocalTime from '@/components/LocalTime';
import { getIdxSyncStatus } from '@/lib/idxAdmin';
import RunSyncButton from './RunSyncButton';

export const dynamic = 'force-dynamic';

function duration(a: Date | null, b: Date | null): string {
  if (!a || !b) return '—';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** /admin/idx-sync — IDX sync status + manual run (IDX spec §2.7). */
export default async function IdxSyncPage() {
  await requireAdmin();
  const status = await getIdxSyncStatus();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">IDX Sync</h1>
          <p className="text-sm text-mute">
            Hourly Realcomp feed sync status, record counts, and coverage.
          </p>
        </div>
        <RunSyncButton />
      </div>

      {status.lastFailure &&
      (!status.lastSuccess ||
        new Date(status.lastFailure.syncStartedAt) > new Date(status.lastSuccess.syncStartedAt)) ? (
        <div className="rounded-lg border border-platinum-red/40 bg-danger-bg px-4 py-3 text-sm text-platinum-red">
          <span className="font-bold">Last sync failed</span> ·{' '}
          <LocalTime value={status.lastFailure.syncStartedAt} /> — {status.lastFailure.errorMessage ?? 'unknown error'}
        </div>
      ) : null}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total listings" value={status.totalCount.toLocaleString()} />
        <StatCard label="Your listings" value={status.officeCount.toLocaleString()} />
        <StatCard label="Market-wide" value={status.marketCount.toLocaleString()} />
        <StatCard
          label="Last successful sync"
          value={status.lastSuccess ? '' : 'Never'}
          node={
            status.lastSuccess ? <LocalTime value={status.lastSuccess.syncCompletedAt ?? status.lastSuccess.syncStartedAt} /> : undefined
          }
        />
      </div>

      {/* By status */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Listings by status</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {status.byStatus.length === 0 ? (
              <p className="text-sm text-mute">No listings synced yet.</p>
            ) : (
              status.byStatus.map((s) => (
                <Badge key={s.status} tone="neutral">
                  {s.status}: {s.count.toLocaleString()}
                </Badge>
              ))
            )}
          </div>
        </CardBody>
      </Card>

      {/* By county */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Coverage by county</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {status.byCounty.length === 0 ? (
              <p className="text-sm text-mute">No listings synced yet.</p>
            ) : (
              status.byCounty.map((c) => (
                <Badge key={c.county ?? 'unknown'} tone="neutral">
                  {c.county ?? 'Unknown'}: {c.count.toLocaleString()}
                </Badge>
              ))
            )}
          </div>
        </CardBody>
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Recent sync runs</h2>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-mute-light">
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Duration</th>
                <th className="py-2 pr-4">Q1 (fetched/upserted)</th>
                <th className="py-2 pr-4">Q2 (fetched/upserted)</th>
                <th className="py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {status.recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-mute">
                    No sync runs yet.
                  </td>
                </tr>
              ) : (
                status.recent.map((r) => (
                  <tr key={r.id} className="border-b border-line-hair">
                    <td className="py-2 pr-4">
                      <LocalTime value={r.syncStartedAt} />
                    </td>
                    <td className="py-2 pr-4">
                      <Badge
                        tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">{duration(r.syncStartedAt, r.syncCompletedAt)}</td>
                    <td className="py-2 pr-4">
                      {r.query1RecordsFetched ?? '—'} / {r.query1RecordsUpserted ?? '—'}
                    </td>
                    <td className="py-2 pr-4">
                      {r.query2RecordsFetched ?? '—'} / {r.query2RecordsUpserted ?? '—'}
                    </td>
                    <td className="py-2 text-platinum-red">{r.errorMessage ?? ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ label, value, node }: { label: string; value: string; node?: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="font-numeric text-2xl font-bold text-charcoal">{node ?? value}</p>
      <p className="mt-0.5 text-xs text-mute-light">{label}</p>
    </div>
  );
}
