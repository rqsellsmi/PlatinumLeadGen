import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createAgent } from '../actions';

export const dynamic = 'force-dynamic';

/** /admin/agents/new — add an agent (reached from the "+ Add agent" button). */
export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: { error?: string; existingId?: string; existingActive?: string };
}) {
  await requireAdmin();
  const officeList = await db
    .select()
    .from(offices)
    .where(eq(offices.isActive, true))
    .orderBy(asc(offices.name));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/admin/agents" className="text-sm font-semibold text-platinum-blue hover:underline">
          ← Back to agents
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-charcoal">Add agent</h1>
        <p className="text-sm text-mute">New agents can set their own password at /agent/set-password.</p>
      </div>

      {/* A taken email is an ordinary outcome, not a fault. It used to surface
          as an unhandled throw and Next's generic error page, which told the
          admin nothing — and the existing record is usually the same person, so
          the link matters more than the message. */}
      {searchParams.error === 'duplicate' ? (
        <div className="rounded-card border border-platinum-red/30 bg-danger-bg px-5 py-4">
          <p className="text-sm font-bold text-platinum-red">That email is already on the roster</p>
          <p className="mt-1 text-sm text-mute">
            An agent record already uses this email address
            {searchParams.existingActive === '0' ? ' and is currently inactive' : ''}. Email is the
            agent&rsquo;s sign-in identity, so it can only belong to one record.
            {searchParams.existingId ? (
              <>
                {' '}
                <Link
                  href={`/admin/agents/${searchParams.existingId}`}
                  className="font-semibold text-platinum-blue hover:underline"
                >
                  Open that agent
                </Link>{' '}
                to check the name on it — it may be the same person under a different name, or an
                old record to reactivate rather than re-add.
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {searchParams.error === 'missing' ? (
        <div className="rounded-card border border-platinum-red/30 bg-danger-bg px-5 py-4">
          <p className="text-sm font-bold text-platinum-red">
            First name, last name and email are all required
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Agent details</h2>
        </CardHeader>
        <CardBody>
          <form action={createAgent} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
            <div>
              <Label htmlFor="officeId">Office</Label>
              <Select id="officeId" name="officeId" defaultValue="">
                <option value="">None</option>
                {officeList.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lat">Latitude</Label>
                <Input id="lat" name="lat" type="number" step="any" />
              </div>
              <div>
                <Label htmlFor="lng">Longitude</Label>
                <Input id="lng" name="lng" type="number" step="any" />
              </div>
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Add agent</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
