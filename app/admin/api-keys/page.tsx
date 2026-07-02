import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiKeys } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import LocalTime from '@/components/LocalTime';
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
        <h1 className="text-2xl font-bold text-charcoal">API keys</h1>
        <p className="text-sm text-mute">External webhook consumers.</p>
      </div>

      {created && (
        <Card className="border-platinum-blue">
          <CardBody>
            <p className="text-sm font-semibold text-platinum-blue">
              New API key created — copy it now. It will not be shown again.
            </p>
            <code className="mt-2 block break-all rounded-md bg-charcoal px-3 py-2 text-sm text-success-bg">
              {created}
            </code>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Generate new key</h2>
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

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Prefix</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Last used</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-mute">
                    No API keys yet.
                  </td>
                </tr>
              )}
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-line-hair last:border-0 hover:bg-offwhite">
                  <td className="px-5 py-3 font-bold text-charcoal">{key.name}</td>
                  <td className="px-5 py-3 font-mono text-mute-light">{key.keyPrefix}…</td>
                  <td className="px-5 py-3">
                    <Badge tone={key.isActive ? 'success' : 'neutral'}>
                      {key.isActive ? 'Active' : 'Revoked'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-mute-light">
                    <LocalTime value={key.lastUsedAt} fallback="Never" />
                  </td>
                  <td className="px-5 py-3 text-right">
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
      </div>
    </div>
  );
}
