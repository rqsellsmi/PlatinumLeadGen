import { Card, CardHeader, CardBody, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import LocalTime from '@/components/LocalTime';
import { formatCurrency } from '@/lib/utils';
import {
  monthUsageStats,
  dailyUsage,
  recentCalls,
  usageProvider,
  FREE_TIER_LIMIT,
} from '@/lib/apiUsage';

export const dynamic = 'force-dynamic';

/** /admin/api-usage — valuation-provider usage monitoring (v1.6 §H). Reports on
 * whichever provider VALUATION_PROVIDER currently selects (RentCast or ATTOM). */
export default async function ApiUsagePage() {
  await requireAdmin();

  const provider = usageProvider();
  const [stats, daily, recent] = await Promise.all([
    monthUsageStats(),
    dailyUsage(30),
    recentCalls(50),
  ]);

  const usedPct = Math.min(100, Math.round((stats.total / FREE_TIER_LIMIT) * 100));
  const barColor = usedPct >= 80 ? 'bg-platinum-red' : usedPct >= 60 ? 'bg-warning' : 'bg-success';
  const maxDay = Math.max(1, ...daily.map((d) => d.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">{provider.label} API Usage</h1>
        <p className="text-sm text-mute">
          Valuation calls this calendar month and recent activity ·{' '}
          <span className="font-semibold text-charcoal">{provider.label}</span> is the active
          provider.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total calls (mo.)" value={String(stats.total)} />
        <StatCard label="Successful" value={String(stats.successful)} tone="success" />
        <StatCard label="Failed" value={String(stats.failed)} tone={stats.failed > 0 ? 'danger' : 'neutral'} />
        <StatCard
          label="Avg response"
          value={stats.avgResponseMs != null ? `${stats.avgResponseMs}ms` : '—'}
        />
      </div>

      {provider.hasFreeTier ? (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Free tier usage</h2>
          </CardHeader>
          <CardBody>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-mute">
                {stats.total}/{FREE_TIER_LIMIT} calls used this month
              </span>
              <span className="font-semibold text-charcoal">{usedPct}%</span>
            </div>
            <div className="h-3 rounded-pill bg-line">
              <div className={`h-3 rounded-pill ${barColor}`} style={{ width: `${usedPct}%` }} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Daily calls (last 30 days)</h2>
        </CardHeader>
        <CardBody>
          {daily.length === 0 ? (
            <p className="text-sm text-mute">No calls in the last 30 days.</p>
          ) : (
            <div className="flex h-40 items-end gap-1">
              {daily.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.total} calls (${d.failed} failed)`}>
                  <div className="flex w-full flex-col justify-end" style={{ height: '100%' }}>
                    {d.failed > 0 ? (
                      <div className="w-full bg-platinum-red" style={{ height: `${(d.failed / maxDay) * 100}%` }} />
                    ) : null}
                    <div className="w-full bg-platinum-blue" style={{ height: `${(d.success / maxDay) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Recent calls</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-charcoal text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Time</th>
                  <th className="px-3 py-2 text-left font-semibold">Address</th>
                  <th className="px-3 py-2 text-right font-semibold">Estimate</th>
                  <th className="px-3 py-2 text-right font-semibold">Response</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-hair">
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-mute">
                      No calls logged yet.
                    </td>
                  </tr>
                ) : null}
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 text-mute">
                      <LocalTime value={c.createdAt} />
                    </td>
                    <td className="px-3 py-2 text-charcoal">{c.propertyAddress ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-numeric">
                      {c.estimatedValue != null ? formatCurrency(c.estimatedValue) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-numeric">
                      {c.responseTimeMs != null ? `${c.responseTimeMs}ms` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {c.success ? <Badge tone="success">OK</Badge> : <Badge tone="danger">Failed</Badge>}
                      {!c.success && c.errorMessage ? (
                        <span className="ml-2 text-xs text-mute-light">{c.errorMessage.slice(0, 60)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  const color =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-platinum-red' : 'text-charcoal';
  return (
    <div className="rounded-card border border-line bg-white px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-mute-light">{label}</p>
      <p className={`mt-1 font-numeric text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
