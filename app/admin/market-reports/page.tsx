import Link from 'next/link';
import { Card, CardBody } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import LocalTime from '@/components/LocalTime';
import { getMarketReportAccessLog } from '@/lib/idxAdmin';

export const dynamic = 'force-dynamic';

/** /admin/market-reports — who opened their market report (IDX spec §8.3). */
export default async function MarketReportsPage() {
  await requireAdmin();
  const rows = await getMarketReportAccessLog();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Market Reports</h1>
        <p className="text-sm text-mute">
          Homeowners who have opened their personalized market report — engaged leads worth a call.
        </p>
      </div>

      <Card>
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-mute-light">
                <th className="py-2 pr-4">Lead</th>
                <th className="py-2 pr-4">City</th>
                <th className="py-2 pr-4">First opened</th>
                <th className="py-2 pr-4">Views</th>
                <th className="py-2">Lead detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-mute">
                    No market reports have been opened yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-hair">
                    <td className="py-2 pr-4">
                      {`${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || `Lead #${r.id}`}
                    </td>
                    <td className="py-2 pr-4">{r.city ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <LocalTime value={r.reportFirstAccessedAt} />
                    </td>
                    <td className="py-2 pr-4">{r.reportViewCount}</td>
                    <td className="py-2">
                      <Link href={`/admin/leads/${r.id}`} className="font-semibold text-platinum-blue hover:underline">
                        View lead →
                      </Link>
                    </td>
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
