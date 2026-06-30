import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, recentSales } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Textarea } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createSale, updateSale, deleteSale, importSalesCsv } from './actions';

export const dynamic = 'force-dynamic';

function toDateInput(d: Date | null): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

export default async function LocationSalesPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  const loc = rows[0];
  if (!loc) notFound();

  const sales = await db
    .select()
    .from(recentSales)
    .where(eq(recentSales.locationId, id))
    .orderBy(asc(recentSales.displayOrder), asc(recentSales.id));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/locations" className="text-sm text-brand-blue hover:underline">
          ← Back to locations
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Recent sales — {loc.name}</h1>
        <p className="text-sm text-slate-500">{sales.length} sales.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Add sale</h2>
        </CardHeader>
        <CardBody>
          <form action={createSale} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <input type="hidden" name="locationId" value={loc.id} />
            <div className="md:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" required />
            </div>
            <div>
              <Label htmlFor="soldPrice">Sold price</Label>
              <Input id="soldPrice" name="soldPrice" type="number" step="1" />
            </div>
            <div>
              <Label htmlFor="daysOnMarket">Days on market</Label>
              <Input id="daysOnMarket" name="daysOnMarket" type="number" step="1" />
            </div>
            <div>
              <Label htmlFor="closeDate">Close date</Label>
              <Input id="closeDate" name="closeDate" type="date" />
            </div>
            <div>
              <Label htmlFor="displayOrder">Display order</Label>
              <Input id="displayOrder" name="displayOrder" type="number" step="1" defaultValue={0} />
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="photoUrl">Photo URL</Label>
              <Input id="photoUrl" name="photoUrl" type="url" />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Add sale</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Import CSV</h2>
        </CardHeader>
        <CardBody>
          <form action={importSalesCsv} className="space-y-3">
            <input type="hidden" name="locationId" value={loc.id} />
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

      <div className="space-y-4">
        {sales.map((sale) => (
          <Card key={sale.id}>
            <CardBody>
              <form action={updateSale} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <input type="hidden" name="saleId" value={sale.id} />
                <input type="hidden" name="locationId" value={loc.id} />
                <div className="md:col-span-2">
                  <Label htmlFor={`addr-${sale.id}`}>Address</Label>
                  <Input id={`addr-${sale.id}`} name="address" defaultValue={sale.address} required />
                </div>
                <div>
                  <Label htmlFor={`price-${sale.id}`}>Sold price</Label>
                  <Input
                    id={`price-${sale.id}`}
                    name="soldPrice"
                    type="number"
                    step="1"
                    defaultValue={sale.soldPrice ?? ''}
                  />
                </div>
                <div>
                  <Label htmlFor={`dom-${sale.id}`}>Days on market</Label>
                  <Input
                    id={`dom-${sale.id}`}
                    name="daysOnMarket"
                    type="number"
                    step="1"
                    defaultValue={sale.daysOnMarket ?? ''}
                  />
                </div>
                <div>
                  <Label htmlFor={`date-${sale.id}`}>Close date</Label>
                  <Input
                    id={`date-${sale.id}`}
                    name="closeDate"
                    type="date"
                    defaultValue={toDateInput(sale.closeDate)}
                  />
                </div>
                <div>
                  <Label htmlFor={`order-${sale.id}`}>Display order</Label>
                  <Input
                    id={`order-${sale.id}`}
                    name="displayOrder"
                    type="number"
                    step="1"
                    defaultValue={sale.displayOrder}
                  />
                </div>
                <div className="md:col-span-3">
                  <Label htmlFor={`photo-${sale.id}`}>Photo URL</Label>
                  <Input
                    id={`photo-${sale.id}`}
                    name="photoUrl"
                    type="url"
                    defaultValue={sale.photoUrl ?? ''}
                  />
                </div>
                <div className="md:col-span-3">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteSale} className="mt-3">
                <input type="hidden" name="saleId" value={sale.id} />
                <input type="hidden" name="locationId" value={loc.id} />
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
