import { Card, CardHeader, CardBody } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import {
  leadsBySource,
  conversionByVariant,
  agentResponseMetrics,
  leadCountSince,
} from '@/lib/analytics';
import CplCalculator from './CplCalculator';

export const dynamic = 'force-dynamic';

/** /admin/analytics (Section 11.2). */
export default async function AnalyticsPage() {
  await requireAdmin();

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [sources, conversion, agentMetrics, leadsLast30] = await Promise.all([
    leadsBySource(),
    conversionByVariant(),
    agentResponseMetrics(),
    leadCountSince(since30),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Analytics</h1>
        <p className="text-sm text-mute">Lead source, SEO vs paid conversion, and agent response.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-bold text-charcoal">SEO vs ADS conversion</h2>
          </CardHeader>
          <CardBody>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-mute-light">
                <tr>
                  <th className="py-2">Variant</th>
                  <th className="py-2">Leads</th>
                  <th className="py-2">Closed</th>
                  <th className="py-2">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-hair">
                {conversion.map((c) => (
                  <tr key={c.variant}>
                    <td className="py-2.5 font-semibold capitalize text-charcoal">{c.variant}</td>
                    <td className="py-2.5 font-numeric">{c.total}</td>
                    <td className="py-2.5 font-numeric">{c.closed}</td>
                    <td className="py-2.5 font-numeric">{(c.rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {conversion.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-mute">
                      No lead data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <CplCalculator leadsLast30={leadsLast30} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Lead source breakdown</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {sources.map((s) => (
                <li key={s.source} className="flex items-center justify-between">
                  <span className="capitalize text-charcoal">{s.source}</span>
                  <span className="font-numeric font-bold">{s.leads}</span>
                </li>
              ))}
              {sources.length === 0 && <li className="text-mute">No leads yet.</li>}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Agent response</h2>
          </CardHeader>
          <CardBody>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-mute-light">
                <tr>
                  <th className="py-2">Agent</th>
                  <th className="py-2">Accepted</th>
                  <th className="py-2">Avg accept</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-hair">
                {agentMetrics.map((a) => (
                  <tr key={a.agentId}>
                    <td className="py-2.5 text-charcoal">{a.name || `Agent #${a.agentId}`}</td>
                    <td className="py-2.5 font-numeric">{a.accepted}</td>
                    <td className="py-2.5 font-numeric">
                      {a.avgAcceptMins != null ? `${a.avgAcceptMins}m` : '—'}
                    </td>
                  </tr>
                ))}
                {agentMetrics.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-mute">
                      No agents yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
