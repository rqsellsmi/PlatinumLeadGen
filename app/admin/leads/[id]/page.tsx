import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agents } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Select, Label, Badge } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { updateLeadStatus, softDeleteLead, reassignLeadAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUSES = ['new', 'contacted', 'qualified', 'closed', 'lost'] as const;

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const leadRows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  const lead = leadRows[0];
  if (!lead) notFound();

  const offers = await db
    .select({
      offer: leadOffers,
      agentFirst: agents.firstName,
      agentLast: agents.lastName,
      agentEmail: agents.email,
    })
    .from(leadOffers)
    .leftJoin(agents, eq(leadOffers.agentId, agents.id))
    .where(eq(leadOffers.leadId, id))
    .orderBy(desc(leadOffers.createdAt));

  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed lead';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/leads" className="text-sm text-brand-blue hover:underline">
            ← Back to leads
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {fullName} <span className="text-slate-400">#{lead.id}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{lead.leadType}</Badge>
          <Badge className="capitalize">{lead.status}</Badge>
          {lead.isDeleted && <Badge className="bg-red-100 text-brand-red">Deleted</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-semibold text-slate-800">Lead details</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
              <Field label="Email" value={lead.email} />
              <Field label="Phone" value={lead.phone} />
              <Field label="Address" value={lead.propertyAddress} />
              <Field
                label="City / State / Zip"
                value={[lead.propertyCity, lead.propertyState, lead.propertyZip]
                  .filter(Boolean)
                  .join(', ')}
              />
              <Field label="Timeframe" value={lead.timeframe} />
              <Field label="Source" value={lead.source} />
              <Field
                label="Estimated value"
                value={lead.estimatedValue != null ? formatCurrency(lead.estimatedValue) : null}
              />
              <Field
                label="Price range"
                value={
                  lead.priceRangeLow != null || lead.priceRangeHigh != null
                    ? `${formatCurrency(lead.priceRangeLow)} – ${formatCurrency(lead.priceRangeHigh)}`
                    : null
                }
              />
              <Field
                label="Created"
                value={lead.createdAt ? new Date(lead.createdAt).toLocaleString('en-US') : null}
              />
              <Field
                label="Coordinates"
                value={
                  lead.propertyLat != null && lead.propertyLng != null
                    ? `${lead.propertyLat}, ${lead.propertyLng}`
                    : null
                }
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-800">Actions</h2>
          </CardHeader>
          <CardBody className="space-y-6">
            <form action={updateLeadStatus} className="space-y-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <Label htmlFor="status">Update status</Label>
              <Select id="status" name="status" defaultValue={lead.status}>
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </Select>
              <Button type="submit" className="w-full">
                Save status
              </Button>
            </form>

            <form action={reassignLeadAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <Button type="submit" variant="secondary" className="w-full">
                Reassign to next agent
              </Button>
              <p className="mt-1 text-xs text-slate-500">
                Excludes agents who already received an offer.
              </p>
            </form>

            {!lead.isDeleted && (
              <form action={softDeleteLead}>
                <input type="hidden" name="leadId" value={lead.id} />
                <Button type="submit" variant="danger" className="w-full">
                  Soft-delete lead
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-800">Offer history</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-brand-blue text-white">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Agent</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Distance</th>
                <th className="px-4 py-2 text-left font-semibold">Sent</th>
                <th className="px-4 py-2 text-left font-semibold">Accepted</th>
                <th className="px-4 py-2 text-left font-semibold">Declined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {offers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No offers yet.
                  </td>
                </tr>
              )}
              {offers.map(({ offer, agentFirst, agentLast, agentEmail }) => (
                <tr key={offer.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className="font-medium">
                      {[agentFirst, agentLast].filter(Boolean).join(' ') || `Agent #${offer.agentId}`}
                    </span>
                    {agentEmail && <span className="block text-xs text-slate-400">{agentEmail}</span>}
                  </td>
                  <td className="px-4 py-2 capitalize">{offer.status}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {offer.distanceMiles != null ? `${offer.distanceMiles.toFixed(1)} mi` : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{fmt(offer.offerSentAt)}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(offer.acceptedAt)}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(offer.declinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value || '—'}</dd>
    </div>
  );
}

function fmt(d: Date | null): string {
  return d ? new Date(d).toLocaleString('en-US') : '—';
}
