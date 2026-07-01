import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, recentSales, type RecentSale, type Location } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Textarea, Select, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createSale, updateSale, deleteSale, importSalesCsv } from './actions';

export const dynamic = 'force-dynamic';

function toDateInput(d: Date | null): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function CitySelect({
  id,
  defaultValue,
  locationList,
}: {
  id: string;
  defaultValue?: number | '';
  locationList: Location[];
}) {
  return (
    <Select id={id} name="locationId" defaultValue={defaultValue ?? ''}>
      <option value="" disabled>
        Choose a city…
      </option>
      {locationList.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </Select>
  );
}

function Fields({ s, prefix, locationList }: { s?: RecentSale; prefix: string; locationList: Location[] }) {
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-locationId`}>City</Label>
        <CitySelect id={`${prefix}-locationId`} defaultValue={s?.locationId} locationList={locationList} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor={`${prefix}-address`}>Address</Label>
        <Input id={`${prefix}-address`} name="address" defaultValue={s?.address ?? ''} required />
      </div>
      <div>
        <Label htmlFor={`${prefix}-soldPrice`}>Sold price</Label>
        <Input id={`${prefix}-soldPrice`} name="soldPrice" type="number" step="1" defaultValue={s?.soldPrice ?? ''} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-daysOnMarket`}>Days on market</Label>
        <Input
          id={`${prefix}-daysOnMarket`}
          name="daysOnMarket"
          type="number"
          step="1"
          defaultValue={s?.daysOnMarket ?? ''}
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-closeDate`}>Close date</Label>
        <Input id={`${prefix}-closeDate`} name="closeDate" type="date" defaultValue={toDateInput(s?.closeDate ?? null)} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-displayOrder`}>Display order</Label>
        <Input
          id={`${prefix}-displayOrder`}
          name="displayOrder"
          type="number"
          step="1"
          defaultValue={s?.displayOrder ?? 0}
        />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-photoUrl`}>Photo URL</Label>
        <Input id={`${prefix}-photoUrl`} name="photoUrl" type="url" defaultValue={s?.photoUrl ?? ''} />
      </div>
    </>
  );
}

export default async function RecentSalesAdminPage() {
  await requireAdmin();

  const [list, locationList] = await Promise.all([
    db
      .select({ s: recentSales, cityName: locations.name })
      .from(recentSales)
      .leftJoin(locations, eq(recentSales.locationId, locations.id))
      .orderBy(asc(locations.name), asc(recentSales.displayOrder), asc(recentSales.id)),
    db.select().from(locations).orderBy(asc(locations.name)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Recent sales</h1>
        <p className="text-sm text-mute">
          {list.length} showcase sales across all cities. Top entries appear in the &ldquo;Recent
          Home Sales&rdquo; grid on each city page. Some rows auto-populate from imported closings.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Add sale</h2>
          </CardHeader>
          <CardBody>
            <form action={createSale} className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Fields prefix="new" locationList={locationList} />
              <div className="md:col-span-3">
                <Button type="submit">Add sale</Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Import CSV</h2>
          </CardHeader>
          <CardBody>
            <form action={importSalesCsv} className="space-y-3">
              <div>
                <Label htmlFor="csv-locationId">City</Label>
                <CitySelect id="csv-locationId" locationList={locationList} />
              </div>
              <Label htmlFor="csv">
                Paste lines: <code>address,soldPrice,daysOnMarket,closeDate,photoUrl</code>
              </Label>
              <Textarea
                id="csv"
                name="csv"
                rows={5}
                placeholder={'123 Main St,425000,9,2025-03-14,https://...\n456 Oak Ave,510000,12,2025-04-02,'}
              />
              <Button type="submit" variant="secondary">
                Import sales
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        {list.length === 0 ? (
          <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
            No recent sales yet.
          </div>
        ) : null}
        {list.map(({ s, cityName }) => (
          <Card key={s.id}>
            <CardBody>
              <div className="mb-3 flex items-center gap-2">
                <Badge tone="info">{cityName ?? 'Unassigned'}</Badge>
                {s.isAutoPopulated ? <Badge tone="neutral">Auto from closings</Badge> : null}
              </div>
              <form action={updateSale} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <input type="hidden" name="saleId" value={s.id} />
                <Fields s={s} prefix={`s${s.id}`} locationList={locationList} />
                <div className="md:col-span-3">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteSale} className="mt-3">
                <input type="hidden" name="saleId" value={s.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete
                </Button>
              </form>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
