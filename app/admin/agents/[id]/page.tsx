import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices, agentScoreLog } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Textarea, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import LocalTime from '@/components/LocalTime';
import { tierFor } from '@/lib/scoreTiers';
import { loadTierContext } from '@/lib/scoreTiersServer';
import { updateAgent, setAgentPassword, adjustScore, deactivateAgent } from './actions';

export const dynamic = 'force-dynamic';

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const agentRows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  const agent = agentRows[0];
  if (!agent) notFound();

  const [officeList, scoreLog] = await Promise.all([
    db.select().from(offices).orderBy(asc(offices.name)),
    db
      .select()
      .from(agentScoreLog)
      .where(eq(agentScoreLog.agentId, id))
      .orderBy(desc(agentScoreLog.createdAt))
      .limit(100),
  ]);

  const tier = tierFor(agent.scoreLifetime, await loadTierContext());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/agents" className="text-sm font-semibold text-platinum-blue hover:underline">
            ← Back to agents
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-charcoal">
            {agent.firstName} {agent.lastName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-bold ${tier.color}`}>{tier.label}</span>
          <Badge tone="info">Lifetime {agent.scoreLifetime.toFixed(1)}</Badge>
          <Badge tone="neutral">Routing (365d) {agent.scoreRolling365.toFixed(1)}</Badge>
          <Badge tone="neutral">YTD {agent.scoreYtd.toFixed(1)}</Badge>
          <Badge tone="neutral">Month {agent.scoreMonthly.toFixed(1)}</Badge>
          <Badge tone={agent.isActive ? 'success' : 'neutral'}>
            {agent.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Edit details</h2>
          </CardHeader>
          <CardBody>
            <form action={updateAgent} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="agentId" value={agent.id} />
              <div>
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" defaultValue={agent.firstName} required />
              </div>
              <div>
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" defaultValue={agent.lastName} required />
              </div>
              <div className="col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={agent.email} required />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" defaultValue={agent.phone ?? ''} />
              </div>
              <div>
                <Label htmlFor="officeId">Office</Label>
                <Select id="officeId" name="officeId" defaultValue={agent.officeId ?? ''}>
                  <option value="">None</option>
                  {officeList.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="proximityAnchor">Measure distance from</Label>
                <Select
                  id="proximityAnchor"
                  name="proximityAnchor"
                  defaultValue={agent.proximityAnchor}
                >
                  <option value="office">Office</option>
                  <option value="custom">A city</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="radiusMiles">Accept within (mi)</Label>
                <Input
                  id="radiusMiles"
                  name="radiusMiles"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={agent.proximityRadiusMiles ?? ''}
                  placeholder="Brokerage default"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="locationCity">City (used when anchor is “A city”)</Label>
                <Input
                  id="locationCity"
                  name="locationCity"
                  defaultValue={agent.locationCity ?? ''}
                  placeholder="e.g. Ann Arbor, MI"
                />
                {agent.proximityAnchor === 'custom' && agent.latitude == null ? (
                  <p className="mt-1 text-xs text-platinum-red">
                    City hasn&rsquo;t geocoded — routing falls back to the office anchor.
                  </p>
                ) : null}
              </div>
              <div className="col-span-2">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-bold text-charcoal">Set password</h2>
            </CardHeader>
            <CardBody>
              <ResetOnSubmitForm action={setAgentPassword} className="flex items-end gap-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <div className="flex-1">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" name="password" type="password" minLength={8} required />
                </div>
                <Button type="submit">Set</Button>
              </ResetOnSubmitForm>
              <p className="mt-2 text-xs text-mute-light">
                {agent.passwordHash ? 'A password is currently set.' : 'No password set yet.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-bold text-charcoal">Manual score adjustment</h2>
            </CardHeader>
            <CardBody>
              <ResetOnSubmitForm action={adjustScore} className="space-y-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <div>
                  <Label htmlFor="delta">Delta (+/-)</Label>
                  <Input id="delta" name="delta" type="number" step="0.1" required />
                </div>
                <div>
                  <Label htmlFor="note">Reason (required)</Label>
                  <Textarea id="note" name="note" rows={2} required />
                </div>
                <Button type="submit">Apply adjustment</Button>
              </ResetOnSubmitForm>
            </CardBody>
          </Card>

          {agent.isActive && (
            <Card>
              <CardBody>
                <form action={deactivateAgent}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <Button type="submit" variant="danger">
                    Deactivate agent
                  </Button>
                </form>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Score log</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-left">Reason</th>
                <th className="px-5 py-3 text-left">Delta</th>
                <th className="px-5 py-3 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {scoreLog.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-mute">
                    No score history.
                  </td>
                </tr>
              )}
              {scoreLog.map((row) => (
                <tr key={row.id} className="border-b border-line-hair last:border-0 hover:bg-offwhite">
                  <td className="px-5 py-3 text-mute-light">
                    {row.createdAt ? <LocalTime value={row.createdAt} /> : '—'}
                  </td>
                  <td className="px-5 py-3 text-charcoal">{row.reason}</td>
                  <td
                    className={`px-5 py-3 font-numeric font-bold ${
                      row.delta >= 0 ? 'text-success' : 'text-platinum-red'
                    }`}
                  >
                    {row.delta >= 0 ? '+' : ''}
                    {row.delta.toFixed(1)}
                  </td>
                  <td className="px-5 py-3 text-mute">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
