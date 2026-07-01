import { desc, eq, gte, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { emailSendLog } from '@/drizzle/schema';
import { Card, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';

export const dynamic = 'force-dynamic';

/** /admin/email-log — every MS Graph send attempt (Section 11.2 / 6.4). */
export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string };
}) {
  await requireAdmin();

  const status = searchParams.status === 'sent' || searchParams.status === 'failed'
    ? searchParams.status
    : undefined;
  const days = Number(searchParams.days) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = status
    ? and(gte(emailSendLog.sentAt, since), eq(emailSendLog.status, status))
    : gte(emailSendLog.sentAt, since);

  const rows = await db
    .select()
    .from(emailSendLog)
    .where(where)
    .orderBy(desc(emailSendLog.sentAt))
    .limit(500);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Email Log</h1>
        <p className="text-sm text-mute">Every Microsoft Graph send attempt. Replaces the Resend dashboard.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FilterLink label="All" href="/admin/email-log" active={!status} />
        <FilterLink label="Sent" href="/admin/email-log?status=sent" active={status === 'sent'} />
        <FilterLink label="Failed" href="/admin/email-log?status=failed" active={status === 'failed'} />
        <span className="ml-2 text-mute-light">Last</span>
        {[1, 7, 30].map((d) => (
          <FilterLink
            key={d}
            label={`${d}d`}
            href={`/admin/email-log?${status ? `status=${status}&` : ''}days=${d}`}
            active={days === d}
          />
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-mute-light">
              <tr>
                <th className="px-4 py-3 font-semibold">Sent</th>
                <th className="px-4 py-3 font-semibold">To</th>
                <th className="px-4 py-3 font-semibold">Template</th>
                <th className="px-4 py-3 font-semibold">Subject</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-mute">
                    No emails in this window.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-offwhite">
                  <td className="whitespace-nowrap px-4 py-2.5 text-mute-light">
                    {new Date(r.sentAt).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-2.5">{r.toEmail}</td>
                  <td className="px-4 py-2.5 text-mute">{r.templateName}</td>
                  <td className="max-w-sm truncate px-4 py-2.5" title={r.subject}>
                    {r.subject}
                    {r.status === 'failed' && r.errorMessage && (
                      <span className="block truncate text-xs text-platinum-red" title={r.errorMessage}>
                        {r.errorMessage}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={r.status === 'sent' ? 'success' : 'danger'}>{r.status}</Badge>
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

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      className={`rounded-pill px-3 py-1 font-semibold ${
        active ? 'bg-charcoal text-white' : 'border border-line text-charcoal hover:bg-offwhite'
      }`}
    >
      {label}
    </a>
  );
}
