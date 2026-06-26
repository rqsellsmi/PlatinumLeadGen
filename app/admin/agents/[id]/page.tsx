import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices, agentScoreLog } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Textarea, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/agents" className="text-sm text-brand-blue hover:underline">
            ← Back to agents
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {agent.firstName} {agent.lastName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge>Score {agent.score.toFixed(1)}</Badge>
          {agent.isActive ? (
            <Badge className="bg-green-100 text-green-700">Active</Badge>
          ) : (
            <Badge className="bg-slate-100 text-slate-500">Inactive</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-800">Edit details</h2>
          </CardHeader>
          <CardBody>
            <form action={updateAgent} className="grid grid-cols-2 gap-4">
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
                <Label htmlFor="lat">Latitude</Label>
                <Input id="lat" name="lat" type="number" step="any" defaultValue={agent.latitude ?? ''} />
              </div>
              <div>
                <Label htmlFor="lng">Longitude</Label>
                <Input id="lng" name="lng" type="number" step="any" defaultValue={agent.longitude ?? ''} />
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
              <h2 className="font-semibold text-slate-800">Set password</h2>
            </CardHeader>
            <CardBody>
              <form action={setAgentPassword} className="flex items-end gap-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <div className="flex-1">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" name="password" type="password" minLength={8} required />
                </div>
                <Button type="submit">Set</Button>
              </form>
              <p className="mt-2 text-xs text-slate-500">
                {agent.passwordHash ? 'A password is currently set.' : 'No password set yet.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-slate-800">Manual score adjustment</h2>
            </CardHeader>
            <CardBody>
              <form action={adjustScore} className="space-y-3">
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
              </form>
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
          <h2 className="font-semibold text-slate-800">Score log</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-brand-blue text-white">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Date</th>
                <th className="px-4 py-2 text-left font-semibold">Reason</th>
                <th className="px-4 py-2 text-left font-semibold">Delta</th>
                <th className="px-4 py-2 text-left font-semibold">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scoreLog.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    No score history.
                  </td>
                </tr>
              )}
              {scoreLog.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-500">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString('en-US') : '—'}
                  </td>
                  <td className="px-4 py-2">{row.reason}</td>
                  <td
                    className={`px-4 py-2 font-medium ${
                      row.delta >= 0 ? 'text-green-700' : 'text-brand-red'
                    }`}
                  >
                    {row.delta >= 0 ? '+' : ''}
                    {row.delta.toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
