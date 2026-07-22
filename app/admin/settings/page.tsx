import { db } from '@/lib/db';
import { notificationSettings } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { saveSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireAdmin();

  // Single-row config — insert defaults if missing.
  let rows = await db.select().from(notificationSettings).limit(1);
  if (rows.length === 0) {
    rows = await db.insert(notificationSettings).values({}).returning();
  }
  const settings = rows[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Settings</h1>
        <p className="text-sm text-mute">Notification and routing configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Notification settings</h2>
        </CardHeader>
        <CardBody>
          <form action={saveSettings} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="notificationEmail">Notification email</Label>
              <Input
                id="notificationEmail"
                name="notificationEmail"
                type="email"
                defaultValue={settings.notificationEmail ?? ''}
              />
            </div>
            <div>
              <Label htmlFor="offerWindowStartHour">Offer window start hour (0–23)</Label>
              <Input
                id="offerWindowStartHour"
                name="offerWindowStartHour"
                type="number"
                min={0}
                max={23}
                defaultValue={settings.offerWindowStartHour}
              />
            </div>
            <div>
              <Label htmlFor="offerWindowEndHour">Offer window end hour (0–23)</Label>
              <Input
                id="offerWindowEndHour"
                name="offerWindowEndHour"
                type="number"
                min={0}
                max={23}
                defaultValue={settings.offerWindowEndHour}
              />
            </div>
            <div>
              <Label htmlFor="proximityRadiusMiles">Proximity radius (miles)</Label>
              <Input
                id="proximityRadiusMiles"
                name="proximityRadiusMiles"
                type="number"
                min={1}
                defaultValue={settings.proximityRadiusMiles}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="agentSetupCode">Agent setup code</Label>
              <Input
                id="agentSetupCode"
                name="agentSetupCode"
                defaultValue={settings.agentSetupCode ?? ''}
                placeholder="e.g. PLATINUM2026"
              />
              <p className="mt-1 text-xs text-mute-light">
                Share this with your agents along with the link{' '}
                <span className="font-semibold">/agent/set-password</span> so they can set (or
                reset) their own password. Leave blank to close the setup page.
              </p>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Save settings</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
