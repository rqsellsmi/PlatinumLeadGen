import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { closings } from '@/drizzle/schema';
import { Card, CardHeader, CardBody } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { formatCurrency, formatMonthYear } from '@/lib/utils';
import RecentSalePhoto from './RecentSalePhoto';

export const dynamic = 'force-dynamic';

/**
 * DEPRECATED (IDX migration): recent-sales tiles now come from the IDX feed
 * (public pages read our IDX office listings first). This page still edits
 * photos on legacy imported `closings` rows, so it queries closings directly
 * (not the IDX-first public helpers) to keep the photo editor's ids correct.
 */
export default async function RecentSalesAdminPage() {
  await requireAdmin();

  const sales = await db
    .select({
      id: closings.id,
      address: closings.address,
      soldPrice: closings.salePrice,
      daysOnMarket: closings.daysOnMarket,
      closeDate: closings.closeDate,
      photoUrl: closings.photoUrl,
      cityName: closings.city,
    })
    .from(closings)
    .where(and(eq(closings.agentRole, 'listing'), inArray(closings.propertyType, ['RS', 'CO'])))
    .orderBy(desc(closings.closeDate))
    .limit(60);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-charcoal">
        <span className="font-bold">Deprecated.</span> Recent sales now come from the IDX feed
        automatically (photos included). This page only edits photos on legacy CSV-imported sales.
      </div>
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Recent sales (legacy CSV)</h1>
        <p className="text-sm text-mute">
          Photos for legacy imported list-side closings. New recent sales and their photos are
          pulled from the MLS feed — see <span className="font-semibold">IDX → IDX Listings</span>.
        </p>
      </div>

      {sales.length === 0 ? (
        <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
          No legacy CSV sales. Recent sales now come from the IDX feed automatically.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">On-tile sales — {sales.length}</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {sales.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-3 border-b border-line-hair pb-3 last:border-0"
              >
                <div className="min-w-0 flex-1 basis-64">
                  <p className="truncate font-bold text-charcoal">
                    {s.address}
                    {s.cityName ? <span className="font-normal text-mute-light"> · {s.cityName}</span> : null}
                  </p>
                  <p className="text-xs text-mute-light">
                    <span className="font-numeric font-bold text-charcoal">
                      {formatCurrency(s.soldPrice)}
                    </span>
                    {s.closeDate ? ` · Sold ${formatMonthYear(s.closeDate)}` : ''}
                    {s.daysOnMarket != null ? ` · ${s.daysOnMarket} DOM` : ''}
                  </p>
                </div>
                <RecentSalePhoto closingId={s.id} initialUrl={s.photoUrl} address={s.address} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
