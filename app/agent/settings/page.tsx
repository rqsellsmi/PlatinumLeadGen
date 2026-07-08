import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices, notificationSettings } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { Card, CardHeader, CardBody, Button, Input, Label, Select } from '@/components/ui';
import { updateRoutingPreferences } from './actions';

export const dynamic = 'force-dynamic';

export default async function AgentSettingsPage() {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  const [officeRows, settingsRows] = await Promise.all([
    agent.officeId
      ? db.select({ name: offices.name, city: offices.city }).from(offices).where(eq(offices.id, agent.officeId)).limit(1)
      : Promise.resolve([]),
    db.select({ radius: notificationSettings.proximityRadiusMiles }).from(notificationSettings).limit(1),
  ]);
  const office = officeRows[0] ?? null;
  const defaultRadius = settingsRows[0]?.radius ?? 20;
  const officeLabel = office ? [office.name, office.city].filter(Boolean).join(' · ') : 'No office assigned';
  const geocoded = agent.proximityAnchor === 'custom' && agent.latitude != null && agent.longitude != null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Routing preferences</h1>
        <p className="text-sm text-mute">
          Choose where your lead-acceptance distance is measured from, and how far you&rsquo;ll accept
          leads.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Proximity</h2>
        </CardHeader>
        <CardBody>
          <form action={updateRoutingPreferences} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="proximityAnchor">Measure distance from</Label>
              <Select id="proximityAnchor" name="proximityAnchor" defaultValue={agent.proximityAnchor}>
                <option value="office">My office</option>
                <option value="custom">A city I choose</option>
              </Select>
              <p className="mt-1 text-xs text-mute-light">Office: {officeLabel}</p>
            </div>

            <div>
              <Label htmlFor="radiusMiles">Accept leads within (miles)</Label>
              <Input
                id="radiusMiles"
                name="radiusMiles"
                type="number"
                min="1"
                step="1"
                defaultValue={agent.proximityRadiusMiles ?? ''}
                placeholder={`Brokerage default (${defaultRadius})`}
              />
              <p className="mt-1 text-xs text-mute-light">Leave blank to use the brokerage default.</p>
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="locationCity">My city (used when measuring from a city I choose)</Label>
              <Input
                id="locationCity"
                name="locationCity"
                defaultValue={agent.locationCity ?? ''}
                placeholder="e.g. Ann Arbor, MI"
              />
              <p className="mt-1 text-xs text-mute-light">
                {agent.proximityAnchor === 'custom'
                  ? geocoded
                    ? 'Location set — leads are measured from this city.'
                    : 'Enter a city so we can locate you; otherwise we fall back to your office.'
                  : 'Only used when the anchor above is “A city I choose”.'}
              </p>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit">Save preferences</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
