import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createLocation, toggleLocationActive, updateLocationDistrict } from './actions';

export const dynamic = 'force-dynamic';

const EDITORS = [
  { suffix: 'seo', label: 'SEO' },
  { suffix: 'stats', label: 'Stats' },
  { suffix: 'sales', label: 'Sales' },
  { suffix: 'testimonials', label: 'Testimonials' },
];

export default async function LocationsPage() {
  await requireAdmin();
  const list = await db.select().from(locations).orderBy(asc(locations.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Locations</h1>
        <p className="text-sm text-slate-500">{list.length} city pages.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Add location</h2>
        </CardHeader>
        <CardBody>
          <form action={createLocation} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <Label htmlFor="name">City name</Label>
              <Input id="name" name="name" required />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" defaultValue="MI" />
            </div>
            <div>
              <Label htmlFor="lat">Latitude</Label>
              <Input id="lat" name="lat" type="number" step="any" />
            </div>
            <div>
              <Label htmlFor="lng">Longitude</Label>
              <Input id="lng" name="lng" type="number" step="any" />
            </div>
            <div className="md:col-span-4">
              <Button type="submit">Add location</Button>
              <p className="mt-1 text-xs text-slate-500">Slug is generated automatically from the name.</p>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-brand-blue text-white">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Slug</th>
                <th className="px-4 py-2 text-left font-semibold">State</th>
                <th className="px-4 py-2 text-left font-semibold">School District</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Editors</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No locations yet.
                  </td>
                </tr>
              )}
              {list.map((loc) => (
                <tr key={loc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{loc.name}</td>
                  <td className="px-4 py-2 text-slate-500">{loc.slug}</td>
                  <td className="px-4 py-2 text-slate-600">{loc.state}</td>
                  <td className="px-4 py-2">
                    <form action={updateLocationDistrict} className="flex items-center gap-1">
                      <input type="hidden" name="locationId" value={loc.id} />
                      <Input
                        name="schoolDistrict"
                        defaultValue={loc.schoolDistrict ?? ''}
                        placeholder="District"
                        className="h-8 w-40 text-xs"
                        aria-label="School District — used to match closings to this city"
                      />
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  </td>
                  <td className="px-4 py-2">
                    {loc.isActive ? (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      {EDITORS.map((e) => (
                        <Link
                          key={e.suffix}
                          href={`/admin/locations/${loc.id}/${e.suffix}`}
                          className="text-brand-blue hover:underline"
                        >
                          {e.label}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <form action={toggleLocationActive} className="inline">
                      <input type="hidden" name="locationId" value={loc.id} />
                      <input type="hidden" name="isActive" value={String(loc.isActive)} />
                      <Button type="submit" size="sm" variant="outline">
                        {loc.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
