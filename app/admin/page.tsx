import Link from 'next/link';
import { and, count, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, agents, leadOffers } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';

export const dynamic = 'force-dynamic';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed', 'lost'] as const;
const LEAD_TYPES = ['valuation', 'seller_guide', 'webhook'] as const;

export default async function AdminOverviewPage() {
  await requireAdmin();

  const [byStatusRows, byTypeRows, activeAgentsRows, pendingOffersRows] = await Promise.all([
    db
      .select({ status: leads.status, n: count() })
      .from(leads)
      .where(eq(leads.isDeleted, false))
      .groupBy(leads.status),
    db
      .select({ leadType: leads.leadType, n: count() })
      .from(leads)
      .where(eq(leads.isDeleted, false))
      .groupBy(leads.leadType),
    db.select({ n: count() }).from(agents).where(eq(agents.isActive, true)),
    db.select({ n: count() }).from(leadOffers).where(eq(leadOffers.status, 'offered')),
  ]);

  const statusCounts = Object.fromEntries(byStatusRows.map((r) => [r.status, r.n]));
  const typeCounts = Object.fromEntries(byTypeRows.map((r) => [r.leadType, r.n]));
  const activeAgents = activeAgentsRows[0]?.n ?? 0;
  const pendingOffers = pendingOffersRows[0]?.n ?? 0;
  const totalLeads = byStatusRows.reduce((acc, r) => acc + Number(r.n), 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">Lead pipeline and routing snapshot.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total leads" value={totalLeads} />
        <StatCard label="Active agents" value={activeAgents} href="/admin/agents" />
        <StatCard label="Pending offers" value={pendingOffers} href="/admin/leads?status=new" />
        <StatCard label="Closed" value={Number(statusCounts['closed'] ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Leads by status</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-3">
            {LEAD_STATUSES.map((s) => (
              <Link key={s} href={`/admin/leads?status=${s}`} className="block">
                <Badge className="capitalize">
                  {s}: {Number(statusCounts[s] ?? 0)}
                </Badge>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Leads by type</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-3">
            {LEAD_TYPES.map((t) => (
              <Link key={t} href={`/admin/leads?type=${t}`} className="block">
                <Badge className="capitalize">
                  {t.replace('_', ' ')}: {Number(typeCounts[t] ?? 0)}
                </Badge>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Quick links</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-3 text-sm">
            <QuickLink href="/admin/leads" label="All leads" />
            <QuickLink href="/admin/agents" label="Agents" />
            <QuickLink href="/admin/offices" label="Offices" />
            <QuickLink href="/admin/locations" label="Locations" />
            <QuickLink href="/admin/api-keys" label="API keys" />
            <QuickLink href="/admin/settings" label="Settings" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <Card className="h-full">
      <CardBody>
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-3xl font-bold text-brand-blue">{value}</p>
      </CardBody>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-brand-blue hover:bg-brand-light"
    >
      {label}
    </Link>
  );
}
