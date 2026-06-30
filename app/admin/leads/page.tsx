import Link from 'next/link';
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads } from '@/drizzle/schema';
import { Card, CardBody, Button, Input, Select, Label, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATUSES = ['new', 'contacted', 'qualified', 'closed', 'lost'] as const;
const TYPES = ['valuation', 'seller_guide', 'webhook'] as const;

function isStatus(v: string | undefined): v is (typeof STATUSES)[number] {
  return !!v && (STATUSES as readonly string[]).includes(v);
}
function isType(v: string | undefined): v is (typeof TYPES)[number] {
  return !!v && (TYPES as readonly string[]).includes(v);
}

interface SearchParams {
  page?: string;
  status?: string;
  type?: string;
  q?: string;
  from?: string;
  to?: string;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const status = searchParams.status;
  const type = searchParams.type;
  const q = (searchParams.q ?? '').trim();
  const from = searchParams.from;
  const to = searchParams.to;

  const conditions: SQL[] = [eq(leads.isDeleted, false)];
  if (isStatus(status)) conditions.push(eq(leads.status, status));
  if (isType(type)) conditions.push(eq(leads.leadType, type));
  if (q) {
    const pattern = `%${q}%`;
    const search = or(
      ilike(leads.firstName, pattern),
      ilike(leads.lastName, pattern),
      ilike(leads.propertyAddress, pattern),
      ilike(leads.email, pattern),
    );
    if (search) conditions.push(search);
  }
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(leads.createdAt, d));
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(leads.createdAt, d));
    }
  }

  const where = and(...conditions);

  const [totalRows, rows] = await Promise.all([
    db.select({ n: count() }).from(leads).where(where),
    db
      .select()
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);

  const total = totalRows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (q) params.set('q', q);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', String(p));
    return `/admin/leads?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
        <p className="text-sm text-slate-500">{total} matching leads (soft-deleted excluded).</p>
      </div>

      <Card>
        <CardBody>
          <form method="get" className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <Label htmlFor="q">Search</Label>
              <Input id="q" name="q" defaultValue={q} placeholder="Name, address, email" />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={status ?? ''}>
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <Select id="type" name="type" defaultValue={type ?? ''}>
                <option value="">All</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={from ?? ''} />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={to ?? ''} />
            </div>
            <div className="flex items-end gap-2 md:col-span-6">
              <Button type="submit">Filter</Button>
              <Link href="/admin/leads">
                <Button type="button" variant="outline">
                  Reset
                </Button>
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-brand-blue text-white">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">#</th>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Address</th>
                <th className="px-4 py-2 text-left font-semibold">Type</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No leads found.
                  </td>
                </tr>
              )}
              {rows.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/admin/leads/${lead.id}`} className="font-medium text-brand-blue">
                      {lead.id}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/admin/leads/${lead.id}`} className="text-brand-blue hover:underline">
                      {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{lead.propertyAddress ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge>{lead.leadType}</Badge>
                  </td>
                  <td className="px-4 py-2 capitalize">{lead.status}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-US') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={pageHref(page - 1)}>
              <Button variant="outline">Previous</Button>
            </Link>
          )}
          {page < totalPages && (
            <Link href={pageHref(page + 1)}>
              <Button variant="outline">Next</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
