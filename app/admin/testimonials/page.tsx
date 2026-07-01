import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, testimonials, type Testimonial, type Location } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Textarea, Select, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createTestimonial, updateTestimonial, deleteTestimonial } from './actions';

export const dynamic = 'force-dynamic';

function Fields({
  t,
  prefix,
  locationList,
}: {
  t?: Testimonial;
  prefix: string;
  locationList: Location[];
}) {
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-locationId`}>City</Label>
        <Select id={`${prefix}-locationId`} name="locationId" defaultValue={t?.locationId ?? ''}>
          <option value="" disabled>
            Choose a city…
          </option>
          {locationList.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor={`${prefix}-clientName`}>Client name</Label>
        <Input id={`${prefix}-clientName`} name="clientName" defaultValue={t?.clientName ?? ''} required />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-quote`}>Quote</Label>
        <Textarea id={`${prefix}-quote`} name="quote" rows={2} defaultValue={t?.quote ?? ''} required />
      </div>
      <div>
        <Label htmlFor={`${prefix}-neighborhood`}>Neighborhood</Label>
        <Input id={`${prefix}-neighborhood`} name="neighborhood" defaultValue={t?.neighborhood ?? ''} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-saleDetails`}>Sale details (badge)</Label>
        <Input id={`${prefix}-saleDetails`} name="saleDetails" defaultValue={t?.saleDetails ?? ''} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-displayOrder`}>Display order</Label>
        <Input
          id={`${prefix}-displayOrder`}
          name="displayOrder"
          type="number"
          step="1"
          defaultValue={t?.displayOrder ?? 0}
        />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-photoUrl`}>Photo URL</Label>
        <Input id={`${prefix}-photoUrl`} name="photoUrl" type="url" defaultValue={t?.photoUrl ?? ''} />
      </div>
      <div className="flex items-center gap-6 md:col-span-3">
        <label className="flex items-center gap-2 text-sm text-charcoal">
          <input type="checkbox" name="isActive" defaultChecked={t ? t.isActive : true} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm text-charcoal">
          <input type="checkbox" name="isFeatured" defaultChecked={t ? t.isFeatured : false} /> Featured
          (homepage)
        </label>
      </div>
    </>
  );
}

export default async function TestimonialsAdminPage() {
  await requireAdmin();

  const [list, locationList] = await Promise.all([
    db
      .select({ t: testimonials, cityName: locations.name })
      .from(testimonials)
      .leftJoin(locations, eq(testimonials.locationId, locations.id))
      .orderBy(asc(locations.name), asc(testimonials.displayOrder), asc(testimonials.id)),
    db.select().from(locations).orderBy(asc(locations.name)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Testimonials</h1>
        <p className="text-sm text-mute">
          {list.length} testimonials across all cities. These appear on the city landing pages;
          &ldquo;Featured&rdquo; ones can also surface on the homepage.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Add testimonial</h2>
        </CardHeader>
        <CardBody>
          <form action={createTestimonial} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Fields prefix="new" locationList={locationList} />
            <div className="md:col-span-3">
              <Button type="submit">Add testimonial</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {list.length === 0 ? (
          <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
            No testimonials yet.
          </div>
        ) : null}
        {list.map(({ t, cityName }) => (
          <Card key={t.id}>
            <CardBody>
              <div className="mb-3 flex items-center gap-2">
                <Badge tone="info">{cityName ?? 'Unassigned'}</Badge>
                {t.isFeatured ? <Badge tone="purple">Featured</Badge> : null}
                {!t.isActive ? <Badge tone="neutral">Hidden</Badge> : null}
              </div>
              <form action={updateTestimonial} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <input type="hidden" name="testimonialId" value={t.id} />
                <Fields t={t} prefix={`t${t.id}`} locationList={locationList} />
                <div className="flex gap-2 md:col-span-3">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteTestimonial} className="mt-3">
                <input type="hidden" name="testimonialId" value={t.id} />
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
