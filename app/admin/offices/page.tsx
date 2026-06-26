import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices, type Office } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createOffice, updateOffice, deleteOffice } from './actions';

export const dynamic = 'force-dynamic';

const FIELDS: { name: keyof Office; label: string; type?: string }[] = [
  { name: 'name', label: 'Name' },
  { name: 'address', label: 'Address' },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'zip', label: 'Zip' },
  { name: 'phone', label: 'Phone' },
  { name: 'latitude', label: 'Latitude', type: 'number' },
  { name: 'longitude', label: 'Longitude', type: 'number' },
];

export default async function OfficesPage() {
  await requireAdmin();
  const list = await db.select().from(offices).orderBy(asc(offices.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Offices</h1>
        <p className="text-sm text-slate-500">{list.length} offices.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Add office</h2>
        </CardHeader>
        <CardBody>
          <form action={createOffice} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {FIELDS.map((f) => (
              <div key={f.name}>
                <Label htmlFor={`new-${f.name}`}>{f.label}</Label>
                <Input
                  id={`new-${f.name}`}
                  name={f.name}
                  type={f.type ?? 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  required={f.name === 'name'}
                />
              </div>
            ))}
            <div className="md:col-span-4">
              <Button type="submit">Add office</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {list.map((office) => (
          <Card key={office.id}>
            <CardBody>
              <form action={updateOffice} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <input type="hidden" name="officeId" value={office.id} />
                {FIELDS.map((f) => (
                  <div key={f.name}>
                    <Label htmlFor={`o${office.id}-${f.name}`}>{f.label}</Label>
                    <Input
                      id={`o${office.id}-${f.name}`}
                      name={f.name}
                      type={f.type ?? 'text'}
                      step={f.type === 'number' ? 'any' : undefined}
                      defaultValue={(office[f.name] as string | number | null) ?? ''}
                      required={f.name === 'name'}
                    />
                  </div>
                ))}
                <div className="flex items-end gap-2 md:col-span-4">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteOffice} className="mt-3">
                <input type="hidden" name="officeId" value={office.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete office
                </Button>
              </form>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
