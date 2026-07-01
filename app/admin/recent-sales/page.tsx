import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import {
  getFeaturedRecentSales,
  getCityRecentSales,
  locationMatchCities,
  type HomeRecentSale,
} from '@/lib/queries';
import { Card, CardHeader, CardBody, Button, Input } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { formatCurrency, formatMonthYear } from '@/lib/utils';
import { updateClosingPhoto } from './actions';

export const dynamic = 'force-dynamic';

export default async function RecentSalesAdminPage() {
  await requireAdmin();

  const locs = await db
    .select()
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.name));

  const [home, perCity] = await Promise.all([
    getFeaturedRecentSales(12),
    Promise.all(locs.map((l) => getCityRecentSales(locationMatchCities(l), 6))),
  ]);

  // Union of every sale that can appear on a tile (homepage + each city), by id.
  const byId = new Map<number, HomeRecentSale>();
  for (const s of home) byId.set(s.id, s);
  for (const list of perCity) for (const s of list) byId.set(s.id, s);
  const sales = [...byId.values()].sort(
    (a, b) => (b.closeDate?.getTime() ?? 0) - (a.closeDate?.getTime() ?? 0),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Recent sales</h1>
        <p className="text-sm text-mute">
          Sales are pulled automatically from your imported list-side closings (newest residential
          &amp; condo). Add a photo to any that appear on a tile — you only need the ones on display.
          No photo shows a branded placeholder.
        </p>
      </div>

      {sales.length === 0 ? (
        <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
          No list-side sales imported yet. Upload closings under{' '}
          <span className="font-semibold">Data Upload</span> first.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">On-tile sales — {sales.length}</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {sales.map((s) => (
              <form
                key={s.id}
                action={updateClosingPhoto}
                className="flex flex-wrap items-end gap-3 border-b border-line-hair pb-3 last:border-0"
              >
                <input type="hidden" name="closingId" value={s.id} />
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
                <div className="flex-1 basis-72">
                  <Input
                    name="photoUrl"
                    type="url"
                    defaultValue={s.photoUrl ?? ''}
                    placeholder="https://…/photo.jpg"
                    aria-label={`Photo URL for ${s.address}`}
                  />
                </div>
                <Button type="submit" size="sm" variant="secondary">
                  Save
                </Button>
              </form>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
