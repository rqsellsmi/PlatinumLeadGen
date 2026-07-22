import Link from 'next/link';
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads } from '@/drizzle/schema';
import { Card, CardBody, Button, Input, Select, Label, Badge, statusTone } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import LocalTime from '@/components/LocalTime';
import { formatPriceRange, relativeTime } from '@/lib/utils';
import { leadStatusLabel } from '@/lib/leadLifecycle';
import { LEAD_INTENTS, isLeadIntent, leadIntentLabel, leadIntentTone } from '@/lib/leadIntent';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATUSES = [
  'new',
  'attempted_contact',
  'connected',
  'nurturing',
  'appointment_set',
  'signed',
  'closed',
  'lost',
] as const;
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
  intent?: string;
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
  const intent = searchParams.intent;
  const q = (searchParams.q ?? '').trim();
  const from = searchParams.from;
  const to = searchParams.to;

  const conditions: SQL[] = [eq(leads.isDeleted, false)];
  if (isStatus(status)) conditions.push(eq(leads.status, status));
  if (isType(type)) conditions.push(eq(leads.leadType, type));
  if (isLeadIntent(intent)) conditions.push(eq(leads.intent, intent));
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
    if (intent) params.set('intent', intent);
    if (q) params.set('q', q);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', String(p));
    return `/admin/leads?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Leads</h1>
          <p className="text-sm text-mute">{total} matching leads (soft-deleted excluded).</p>
        </div>
        <Link href="/admin/leads/new">
          <Button>+ Add lead</Button>
        </Link>
      </div>

      <Card>
        <CardBody>
          <form method="get" className="grid grid-cols-1 gap-4 md:grid-cols-7">
            <div className="md:col-span-2">
              <Label htmlFor="q">Search</Label>
              <Input id="q" name="q" defaultValue={q} placeholder="Name, address, email" />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={status ?? ''}>
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {leadStatusLabel(s)}
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
              <Label htmlFor="intent">Buyer/Seller</Label>
              <Select id="intent" name="intent" defaultValue={intent ?? ''}>
                <option value="">All</option>
                {LEAD_INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {leadIntentLabel(i)}
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
            <div className="flex items-end gap-2 md:col-span-7">
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

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                <th className="px-5 py-3 text-left">Lead</th>
                <th className="px-5 py-3 text-left">Est. value</th>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-left">Buyer/Seller</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-mute">
                    No leads found.
                  </td>
                </tr>
              )}
              {rows.map((lead) => (
                <tr key={lead.id} className="border-b border-line-hair last:border-0 hover:bg-offwhite">
                  <td className="px-5 py-3.5">
                    <Link href={`/admin/leads/${lead.id}`} className="block">
                      <span className="font-bold text-charcoal">
                        {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed lead'}
                      </span>
                      <span className="block truncate text-[13px] text-mute-light">
                        {lead.propertyAddress ?? '—'}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-semibold text-mute-lighter">
                        {[lead.source, relativeTime(lead.createdAt)].filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 font-numeric text-lg font-bold text-charcoal">
                    {formatPriceRange(lead.priceRangeLow, lead.priceRangeHigh, lead.estimatedValue) ?? '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge tone="info">{lead.leadType}</Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge tone={leadIntentTone(lead.intent)}>{leadIntentLabel(lead.intent)}</Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge tone={statusTone(lead.status)}>{leadStatusLabel(lead.status)}</Badge>
                  </td>
                  <td className="px-5 py-3.5 text-mute-light">
                    {lead.createdAt ? <LocalTime value={lead.createdAt} dateOnly /> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-mute-light">
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
