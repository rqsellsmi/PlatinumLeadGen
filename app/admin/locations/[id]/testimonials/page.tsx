import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, testimonials, type Testimonial } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Textarea } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createTestimonial, updateTestimonial, deleteTestimonial } from './actions';

export const dynamic = 'force-dynamic';

function Fields({ t, prefix }: { t?: Testimonial; prefix: string }) {
  return (
    <>
      <div className="md:col-span-2">
        <Label htmlFor={`${prefix}-clientName`}>Client name</Label>
        <Input id={`${prefix}-clientName`} name="clientName" defaultValue={t?.clientName ?? ''} required />
      </div>
      <div>
        <Label htmlFor={`${prefix}-neighborhood`}>Neighborhood</Label>
        <Input id={`${prefix}-neighborhood`} name="neighborhood" defaultValue={t?.neighborhood ?? ''} />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-quote`}>Quote</Label>
        <Textarea id={`${prefix}-quote`} name="quote" rows={2} defaultValue={t?.quote ?? ''} required />
      </div>
      <div className="md:col-span-2">
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
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="isActive" defaultChecked={t ? t.isActive : true} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="isFeatured" defaultChecked={t ? t.isFeatured : false} /> Featured
        </label>
      </div>
    </>
  );
}

export default async function LocationTestimonialsPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  const loc = rows[0];
  if (!loc) notFound();

  const list = await db
    .select()
    .from(testimonials)
    .where(eq(testimonials.locationId, id))
    .orderBy(asc(testimonials.displayOrder), asc(testimonials.id));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/locations" className="text-sm text-brand-blue hover:underline">
          ← Back to locations
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Testimonials — {loc.name}</h1>
        <p className="text-sm text-slate-500">{list.length} testimonials.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Add testimonial</h2>
        </CardHeader>
        <CardBody>
          <form action={createTestimonial} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <input type="hidden" name="locationId" value={loc.id} />
            <Fields prefix="new" />
            <div className="md:col-span-3">
              <Button type="submit">Add testimonial</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {list.map((t) => (
          <Card key={t.id}>
            <CardBody>
              <form action={updateTestimonial} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <input type="hidden" name="testimonialId" value={t.id} />
                <input type="hidden" name="locationId" value={loc.id} />
                <Fields t={t} prefix={`t${t.id}`} />
                <div className="md:col-span-3">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteTestimonial} className="mt-3">
                <input type="hidden" name="testimonialId" value={t.id} />
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
