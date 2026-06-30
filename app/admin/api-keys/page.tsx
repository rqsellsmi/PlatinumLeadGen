import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiKeys } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { createApiKey, revokeApiKey } from './actions';

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: { created?: string };
}) {
  await requireAdmin();
  const created = searchParams.created;
  const keys = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">API keys</h1>
        <p className="text-sm text-slate-500">External webhook consumers.</p>
      </div>

      {created && (
        <Card className="border-brand-blue">
          <CardBody>
            <p className="text-sm font-semibold text-brand-blue">
              New API key created — copy it now. It will not be shown again.
            </p>
            <code className="mt-2 block break-all rounded-md bg-slate-900 px-3 py-2 text-sm text-green-300">
              {created}
            </code>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Generate new key</h2>
        </CardHeader>
        <CardBody>
          <form action={createApiKey} className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="name">Source name</Label>
              <Input id="name" name="name" placeholder="e.g. Zapier webhook" required />
            </div>
            <Button type="submit">Generate</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-brand-blue text-white">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Prefix</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Last used</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No API keys yet.
                  </td>
                </tr>
              )}
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{key.name}</td>
                  <td className="px-4 py-2 font-mono text-slate-500">{key.keyPrefix}…</td>
                  <td className="px-4 py-2">
                    {key.isActive ? (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500">Revoked</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString('en-US') : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {key.isActive && (
                      <form action={revokeApiKey} className="inline">
                        <input type="hidden" name="keyId" value={key.id} />
                        <Button type="submit" size="sm" variant="danger">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
