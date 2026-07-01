import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import { Card, CardBody, CardHeader, Input, Label, Select, Button } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createManualLead } from './actions';

export const dynamic = 'force-dynamic';

const TIMEFRAMES = [
  'In the next 3 months',
  '3–6 months',
  '6–12 months',
  '1–2 years',
  'Just researching',
];

/** /admin/leads/new — manual lead entry for offline / LSA phone leads (Section 21.6). */
export default async function NewLeadPage() {
  await requireAdmin();
  const locs = await db
    .select({ slug: locations.slug, name: locations.name })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.name));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/admin/leads" className="text-sm font-semibold text-platinum-blue hover:underline">
          ← Back to leads
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-charcoal">Add lead</h1>
        <p className="text-sm text-mute">Log an offline or Local Services Ads phone lead.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Lead details</h2>
        </CardHeader>
        <CardBody>
          <form action={createManualLead} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" required />
              </div>
              <div>
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>
            </div>
            <div>
              <Label htmlFor="propertyAddress">Property address</Label>
              <Input id="propertyAddress" name="propertyAddress" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="propertyCity">City</Label>
                <Input id="propertyCity" name="propertyCity" />
              </div>
              <div>
                <Label htmlFor="locationSlug">Location page</Label>
                <Select id="locationSlug" name="locationSlug" defaultValue="">
                  <option value="">— none —</option>
                  {locs.map((l) => (
                    <option key={l.slug} value={l.slug}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="timeframe">Timeframe</Label>
              <Select id="timeframe" name="timeframe" defaultValue={TIMEFRAMES[0]}>
                {TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" className="w-full">
              Create lead &amp; route
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
