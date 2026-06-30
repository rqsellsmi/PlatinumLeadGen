import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, statusUpdates } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { Card, CardHeader, CardBody, Badge } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { StatusUpdateForm } from '@/components/agent/StatusUpdateForm';

export const dynamic = 'force-dynamic';

export default async function AgentLeadDetailPage({
  params,
}: {
  params: { leadOfferId: string };
}) {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  const leadOfferId = Number(params.leadOfferId);
  if (!leadOfferId) redirect('/agent/leads');

  // Verify the offer belongs to this agent and is joined to its lead.
  const rows = await db
    .select({ offer: leadOffers, lead: leads })
    .from(leadOffers)
    .innerJoin(leads, eq(leadOffers.leadId, leads.id))
    .where(and(eq(leadOffers.id, leadOfferId), eq(leadOffers.agentId, agent.id)))
    .limit(1);

  const row = rows[0];
  if (!row) redirect('/agent/leads');

  const { offer, lead } = row;
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed lead';
  const address =
    [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip]
      .filter(Boolean)
      .join(', ') || null;
  const priceRange =
    lead.priceRangeLow != null || lead.priceRangeHigh != null
      ? `${formatCurrency(lead.priceRangeLow)} – ${formatCurrency(lead.priceRangeHigh)}`
      : null;

  const history = await db
    .select()
    .from(statusUpdates)
    .where(eq(statusUpdates.leadOfferId, leadOfferId))
    .orderBy(desc(statusUpdates.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/agent/leads" className="text-sm text-brand-blue hover:underline">
          ← Back to my leads
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{fullName}</h1>
          <Badge className="capitalize">{lead.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-semibold text-slate-800">Contact &amp; property</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Name" value={fullName} />
              <Field
                label="Email"
                value={lead.email}
                href={lead.email ? `mailto:${lead.email}` : undefined}
              />
              <Field
                label="Phone"
                value={lead.phone}
                href={lead.phone ? `tel:${lead.phone}` : undefined}
              />
              <Field label="Property address" value={address} />
              <Field
                label="Estimated value"
                value={lead.estimatedValue != null ? formatCurrency(lead.estimatedValue) : null}
              />
              <Field label="Price range" value={priceRange} />
              <Field label="Timeframe" value={lead.timeframe} />
              <Field label="Source" value={lead.source} />
              <Field
                label="Accepted"
                value={offer.acceptedAt ? new Date(offer.acceptedAt).toLocaleString('en-US') : null}
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-800">Update status</h2>
          </CardHeader>
          <CardBody>
            <StatusUpdateForm leadOfferId={offer.id} currentStatus={lead.status} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Update history</h2>
        </CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No updates yet.</p>
          ) : (
            <ul className="space-y-4">
              {history.map((u) => (
                <li key={u.id} className="border-l-2 border-slate-200 pl-4">
                  <div className="flex items-center gap-2">
                    <Badge className="capitalize">{u.newStatus}</Badge>
                    <span className="text-xs text-slate-400">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString('en-US') : ''}
                    </span>
                  </div>
                  {u.note && <p className="mt-1 text-sm text-slate-700">{u.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null | undefined;
  href?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">
        {value ? (
          href ? (
            <a href={href} className="text-brand-blue hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          '—'
        )}
      </dd>
    </div>
  );
}
