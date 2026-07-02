import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, statusUpdates } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { Badge, statusTone } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import LocalTime from '@/components/LocalTime';
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
  const firstName = lead.firstName || 'lead';
  const address =
    [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip]
      .filter(Boolean)
      .join(', ') || null;
  const priceRange =
    lead.priceRangeLow != null || lead.priceRangeHigh != null
      ? `${formatCurrency(lead.priceRangeLow)} – ${formatCurrency(lead.priceRangeHigh)}`
      : lead.estimatedValue != null
        ? formatCurrency(lead.estimatedValue)
        : null;

  const history = await db
    .select()
    .from(statusUpdates)
    .where(eq(statusUpdates.leadOfferId, leadOfferId))
    .orderBy(desc(statusUpdates.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/agent/leads" className="text-sm font-semibold text-platinum-blue hover:underline">
          ← Back to my leads
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <Badge tone={statusTone(lead.status)}>{lead.status}</Badge>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-charcoal">{fullName}</h1>
          {address ? <p className="mt-1 text-sm text-mute-light">{address}</p> : null}
        </div>
        {lead.phone ? (
          <a
            href={`tel:${lead.phone}`}
            className="inline-flex items-center gap-2 rounded-pill bg-platinum-red px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-platinum-redHover"
          >
            📞 Call {firstName}
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Estimate callout */}
          {priceRange ? (
            <div className="rounded-card bg-cream px-6 py-6 text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                Estimated value
              </p>
              <p className="mt-1.5 font-numeric text-4xl font-bold text-charcoal">{priceRange}</p>
            </div>
          ) : null}

          {/* Contact + property */}
          <div className="rounded-card border border-line bg-white">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-bold text-charcoal">Contact &amp; property</h2>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-2">
              <Field label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Field label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <Field label="Property address" value={address} />
              <Field label="Timeframe" value={lead.timeframe} />
              <Field label="Source" value={lead.source} />
              <Field
                label="Accepted"
                value={offer.acceptedAt ? <LocalTime value={offer.acceptedAt} /> : null}
              />
            </dl>
          </div>

          {/* Activity timeline */}
          <div className="rounded-card border border-line bg-white">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-bold text-charcoal">Activity</h2>
            </div>
            <div className="px-5 py-5">
              {history.length === 0 ? (
                <p className="text-sm text-mute">No updates yet.</p>
              ) : (
                <ul className="space-y-0">
                  {history.map((u, i) => (
                    <li key={u.id} className="flex gap-3.5">
                      <div className="flex flex-col items-center">
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-platinum-red" />
                        {i < history.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
                      </div>
                      <div className="pb-5">
                        <div className="flex items-center gap-2">
                          <Badge tone={statusTone(u.newStatus)}>{u.newStatus}</Badge>
                          <span className="text-xs text-mute-lighter">
                            <LocalTime value={u.createdAt} fallback="" />
                          </span>
                        </div>
                        {u.note ? <p className="mt-1.5 text-sm text-charcoal">{u.note}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Update status */}
        <div className="rounded-card border border-line bg-white lg:self-start">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-bold text-charcoal">Log activity</h2>
          </div>
          <div className="px-5 py-5">
            <StatusUpdateForm leadOfferId={offer.id} currentStatus={lead.status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  href,
}: {
  label: string;
  value: ReactNode;
  href?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">{label}</dt>
      <dd className="mt-0.5 text-charcoal">
        {value ? (
          href ? (
            <a href={href} className="font-semibold text-platinum-blue hover:underline">
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
