import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, marketStats } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { saveStats } from './actions';

export const dynamic = 'force-dynamic';

const FIELDS = [
  { name: 'avgSalePrice', label: 'Avg sale price ($)' },
  { name: 'daysToSell', label: 'Days to sell' },
  { name: 'homesSold', label: 'Homes sold (12 mo)' },
  { name: 'percentOfListPrice', label: '% of list price' },
  { name: 'percentAboveList', label: '% sold above list' },
] as const;

export default async function LocationStatsPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  const loc = rows[0];
  if (!loc) notFound();

  const statsRows = await db
    .select()
    .from(marketStats)
    .where(eq(marketStats.locationId, id))
    .limit(1);
  const stats = statsRows[0];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/locations" className="text-sm font-semibold text-platinum-blue hover:underline">
          ← Back to locations
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-charcoal">Market stats — {loc.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Current stats</h2>
        </CardHeader>
        <CardBody>
          <form action={saveStats} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <input type="hidden" name="locationId" value={loc.id} />
            {FIELDS.map((f) => (
              <div key={f.name}>
                <Label htmlFor={f.name}>{f.label}</Label>
                <Input
                  id={f.name}
                  name={f.name}
                  type="number"
                  step="1"
                  defaultValue={(stats?.[f.name] as number | null | undefined) ?? ''}
                />
              </div>
            ))}
            <div className="md:col-span-3">
              <Button type="submit">Save stats</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
