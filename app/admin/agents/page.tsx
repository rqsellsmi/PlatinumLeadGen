import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createAgent, toggleAgentActive } from './actions';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  await requireAdmin();

  const [rows, officeList] = await Promise.all([
    db
      .select({
        agent: agents,
        officeName: offices.name,
      })
      .from(agents)
      .leftJoin(offices, eq(agents.officeId, offices.id))
      .orderBy(asc(agents.lastName), asc(agents.firstName)),
    db.select().from(offices).where(eq(offices.isActive, true)).orderBy(asc(offices.name)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Agents</h1>
        <p className="text-sm text-slate-500">{rows.length} agents.</p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-brand-blue text-white">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Email</th>
                <th className="px-4 py-2 text-left font-semibold">Office</th>
                <th className="px-4 py-2 text-left font-semibold">Score</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No agents yet.
                  </td>
                </tr>
              )}
              {rows.map(({ agent, officeName }) => (
                <tr key={agent.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/agents/${agent.id}`}
                      className="font-medium text-brand-blue hover:underline"
                    >
                      {agent.firstName} {agent.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{agent.email}</td>
                  <td className="px-4 py-2 text-slate-600">{officeName ?? '—'}</td>
                  <td className="px-4 py-2 font-medium">{agent.score.toFixed(1)}</td>
                  <td className="px-4 py-2">
                    {agent.isActive ? (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <form action={toggleAgentActive} className="inline">
                      <input type="hidden" name="agentId" value={agent.id} />
                      <input type="hidden" name="isActive" value={String(agent.isActive)} />
                      <Button type="submit" size="sm" variant="outline">
                        {agent.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Add agent</h2>
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
