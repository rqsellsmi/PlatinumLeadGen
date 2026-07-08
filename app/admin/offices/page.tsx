import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices, type Office } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import { createOffice, updateOffice, deleteOffice } from './actions';

export const dynamic = 'force-dynamic';

// Latitude/longitude are geocoded automatically from the address on save
// (lib/geocode.ts), so they're not manual fields.
const FIELDS: { name: keyof Office; label: string; type?: string }[] = [
  { name: 'name', label: 'Name' },
  { name: 'address', label: 'Address' },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'zip', label: 'Zip' },
  { name: 'phone', label: 'Phone' },
  // Google Business Profile Place ID for this office's reviews (fetched from
  // Admin → Testimonials → "Fetch Google reviews now").
  { name: 'googlePlaceId', label: 'Google Place ID' },
];

function reviewStatus(office: Office): { text: string; isError: boolean } {
  if (office.googleReviewsError) {
    return { text: `Last fetch failed — ${office.googleReviewsError}`, isError: true };
  }
  if (!office.googlePlaceId) {
    return { text: 'No Place ID — add one to pull this office’s Google reviews.', isError: false };
  }
  if (office.googleReviewsFetchedAt == null) {
    return {
      text: 'Place ID set — not fetched yet. Use “Fetch Google reviews now” on the Testimonials page.',
      isError: false,
    };
  }
  const rating = office.googleReviewRating != null ? office.googleReviewRating.toFixed(1) : '—';
  const count = office.googleReviewCount != null ? office.googleReviewCount : '—';
  return {
    text: `Google ${rating}★ (${count} ratings) · last fetched ${office.googleReviewsFetchedAt.toLocaleDateString()}`,
    isError: false,
  };
}

export default async function OfficesPage() {
  await requireAdmin();
  const list = await db.select().from(offices).orderBy(asc(offices.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Offices</h1>
        <p className="text-sm text-mute">{list.length} offices.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Add office</h2>
        </CardHeader>
        <CardBody>
          <ResetOnSubmitForm action={createOffice} className="grid grid-cols-1 gap-4 md:grid-cols-4">
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
          </ResetOnSubmitForm>
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
                {(() => {
                  const s = reviewStatus(office);
                  return (
                    <p
                      className={`text-xs md:col-span-4 ${s.isError ? 'font-semibold text-platinum-red' : 'text-mute-light'}`}
                    >
                      {s.text}
                    </p>
                  );
                })()}
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
