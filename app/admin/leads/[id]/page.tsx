import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, leadOffers, agents, offices, leadEvents } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Select, Label, Badge, statusTone } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { requireAdmin } from '@/components/admin/requireAdmin';
import OfferHistory, { type OfferHistoryItem, type AgentOption } from '@/components/admin/OfferHistory';
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

  // Offer history oldest-first for the timeline (Section 17.2).
  const offerRows = await db
    .select({
      id: leadOffers.id,
      agentId: leadOffers.agentId,
      agentFirst: agents.firstName,
      agentLast: agents.lastName,
      status: leadOffers.status,
      offerSentAt: leadOffers.offerSentAt,
      respondedAt: leadOffers.respondedAt,
      createdAt: leadOffers.createdAt,
    })
    .from(leadOffers)
    .leftJoin(agents, eq(leadOffers.agentId, agents.id))
    .where(eq(leadOffers.leadId, id))
    .orderBy(asc(leadOffers.createdAt));

  const offers: OfferHistoryItem[] = offerRows.map((o) => ({
    id: o.id,
    agentId: o.agentId,
    agentName: [o.agentFirst, o.agentLast].filter(Boolean).join(' ') || `Agent #${o.agentId}`,
    status: o.status,
    offerSentAt: o.offerSentAt ? new Date(o.offerSentAt).toISOString() : null,
    respondedAt: o.respondedAt ? new Date(o.respondedAt).toISOString() : null,
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
  }));

  // Active agents for the manual reassign picker (Section 18.2).
  const agentRows = await db
    .select({
      id: agents.id,
      first: agents.firstName,
      last: agents.lastName,
      isAvailable: agents.isAvailable,
      officeCity: offices.city,
    })
    .from(agents)
    .leftJoin(offices, eq(agents.officeId, offices.id))
    .where(eq(agents.isActive, true))
    .orderBy(asc(agents.firstName));
  const agentOptions: AgentOption[] = agentRows.map((a) => ({
    id: a.id,
    name: [a.first, a.last].filter(Boolean).join(' ') || `Agent #${a.id}`,
    city: a.officeCity ?? null,
    isAvailable: a.isAvailable,
  }));

  // Lead activity timeline (§D.4), newest first.
  const eventRows = await db
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.leadId, id))
    .orderBy(desc(leadEvents.createdAt));

  const hasAttribution = Boolean(
    lead.utmSource ||
      lead.utmMedium ||
      lead.utmCampaign ||
      lead.gclid ||
      lead.referrer ||
      lead.landingPageUrl ||
      lead.deviceType,
  );

  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed lead';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/leads" className="text-sm font-semibold text-platinum-blue hover:underline">
            ← Back to leads
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-charcoal">
            {fullName} <span className="text-mute-lighter">#{lead.id}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{lead.leadType}</Badge>
          {lead.pageVariant && <Badge tone="neutral">{lead.pageVariant}</Badge>}
          <Badge tone={statusTone(lead.status)}>{lead.status}</Badge>
          {lead.isDeleted && <Badge tone="danger">Deleted</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-bold text-charcoal">Lead details</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Email" value={lead.email} />
              <Field label="Phone" value={lead.phone} />
              <Field label="Address" value={lead.propertyAddress} />
              <Field
                label="City / State / Zip"
                value={[lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(', ')}
              />
              <Field label="Timeframe" value={lead.timeframe} />
              <Field label="Source" value={lead.source} />
              <Field label="Page variant" value={lead.pageVariant} />
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
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Actions</h2>
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
                Auto-assign via round-robin
              </Button>
              <p className="mt-1 text-xs text-mute-light">
                Offers the lead to the next agent in the rotation, excluding prior recipients. To
                pick a specific agent, use Reassign under Offer history.
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
          <h2 className="font-bold text-charcoal">Offer history</h2>
        </CardHeader>
        <CardBody>
          <OfferHistory leadId={lead.id} offers={offers} agents={agentOptions} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Attribution</h2>
        </CardHeader>
        <CardBody>
          {hasAttribution ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Source" value={lead.utmSource} />
              <Field label="Medium" value={lead.utmMedium} />
              <Field label="Campaign" value={lead.utmCampaign} />
              <Field label="Content" value={lead.utmContent} />
              <Field label="Term" value={lead.utmTerm} />
              <Field label="Device" value={lead.deviceType} />
              <Field label="gclid" value={lead.gclid} />
              <Field label="Referrer" value={lead.referrer} />
              <Field label="Landing page" value={lead.landingPageUrl} />
              <Field
                label="First seen"
                value={lead.firstSeenAt ? new Date(lead.firstSeenAt).toLocaleString('en-US') : null}
              />
              <Field
                label="Last seen"
                value={lead.lastSeenAt ? new Date(lead.lastSeenAt).toLocaleString('en-US') : null}
              />
            </dl>
          ) : (
            <p className="text-sm text-mute">No attribution captured for this lead.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Activity timeline</h2>
        </CardHeader>
        <CardBody>
          {eventRows.length === 0 ? (
            <p className="text-sm text-mute">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {eventRows.map((e) => (
                <li key={e.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-platinum-blue" />
                  <div>
                    <p className="font-semibold text-charcoal">{formatEventType(e.eventType)}</p>
                    {e.note ? <p className="text-mute">{e.note}</p> : null}
                    <p className="text-xs text-mute-light">
                      {e.createdAt ? new Date(e.createdAt).toLocaleString('en-US') : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function formatEventType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-mute-light">{label}</dt>
      <dd className="text-charcoal">{value || '—'}</dd>
    </div>
  );
}
