import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import { createLocation, toggleLocationActive, updateLocationMatchCities } from './actions';

export const dynamic = 'force-dynamic';

const EDITORS = [
  { suffix: 'seo', label: 'SEO' },
  { suffix: 'stats', label: 'Stats' },
];

export default async function LocationsPage() {
  await requireAdmin();
  const list = await db.select().from(locations).orderBy(asc(locations.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Locations</h1>
        <p className="text-sm text-mute">
          {list.length} city pages. Manage testimonials &amp; recent sales from the{' '}
          <Link href="/admin/testimonials" className="font-semibold text-platinum-blue hover:underline">
            Content
          </Link>{' '}
          section.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Add location</h2>
        </CardHeader>
        <CardBody>
          <ResetOnSubmitForm action={createLocation} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">City name</Label>
              <Input id="name" name="name" required />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" defaultValue="MI" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Add location</Button>
              <p className="mt-1 text-xs text-mute-light">Slug is generated automatically from the name.</p>
            </div>
          </ResetOnSubmitForm>
        </CardBody>
      </Card>

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Slug</th>
                <th className="px-5 py-3 text-left">State</th>
                <th className="px-5 py-3 text-left">Covered cities</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Editors</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-mute">
                    No locations yet.
                  </td>
                </tr>
              )}
              {list.map((loc) => (
                <tr key={loc.id} className="border-b border-line-hair last:border-0 hover:bg-offwhite">
                  <td className="px-5 py-3 font-bold text-charcoal">{loc.name}</td>
                  <td className="px-5 py-3 text-mute-light">{loc.slug}</td>
                  <td className="px-5 py-3 text-mute">{loc.state}</td>
                  <td className="px-5 py-3">
                    <form action={updateLocationMatchCities} className="flex items-center gap-1">
                      <input type="hidden" name="locationId" value={loc.id} />
                      <Input
                        name="matchCities"
                        defaultValue={loc.matchCities ?? ''}
                        placeholder={loc.name.split(',')[0].trim()}
                        className="h-8 w-48 text-xs"
                        aria-label="Mailing cities this page covers — comma-separated; matches imported closings"
                      />
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={loc.isActive ? 'success' : 'neutral'}>
                      {loc.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-3">
                      {EDITORS.map((e) => (
                        <Link
                          key={e.suffix}
                          href={`/admin/locations/${loc.id}/${e.suffix}`}
                          className="font-semibold text-platinum-blue hover:underline"
                        >
                          {e.label}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
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
      </div>
    </div>
  );
}
