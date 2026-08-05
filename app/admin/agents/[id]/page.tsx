import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, offices, agentScoreLog } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Textarea, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import LocalTime from '@/components/LocalTime';
import { tierFor } from '@/lib/scoreTiers';
import { loadTierContext } from '@/lib/scoreTiersServer';
import { updateAgent, setAgentPassword, adjustScore } from './actions';
import { toggleAgentActive, toggleAgentAvailable, resendAgentInvite } from '@/app/admin/agents/actions';
import { MAX_PROXIMITY_RADIUS_MILES, isUnusuallyBroadRadius } from '@/lib/coverage';
import { isTokenExpired } from '@/lib/agentPortalAuth';

export const dynamic = 'force-dynamic';

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!id) notFound();

  const agentRows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  const agent = agentRows[0];
  if (!agent) notFound();

  const [officeList, scoreLog] = await Promise.all([
    db.select().from(offices).orderBy(asc(offices.name)),
    db
      .select()
      .from(agentScoreLog)
      .where(eq(agentScoreLog.agentId, id))
      .orderBy(desc(agentScoreLog.createdAt))
      .limit(100),
  ]);

  const tier = tierFor(agent.scoreLifetime, await loadTierContext());
  // A null expiry counts as expired (isTokenExpired fails closed), which is the
  // right reading here too: no usable invite is outstanding.
  const inviteLive = !isTokenExpired(agent.inviteExpiresAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/agents" className="text-sm font-semibold text-platinum-blue hover:underline">
            ← Back to agents
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-charcoal">
            {agent.firstName} {agent.lastName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-bold ${tier.color}`}>{tier.label}</span>
          <Badge tone="info">Lifetime {agent.scoreLifetime.toFixed(1)}</Badge>
          <Badge tone="neutral">Routing (365d) {agent.scoreRolling365.toFixed(1)}</Badge>
          <Badge tone="neutral">YTD {agent.scoreYtd.toFixed(1)}</Badge>
          <Badge tone="neutral">Month {agent.scoreMonthly.toFixed(1)}</Badge>
          <Badge tone={agent.isActive ? 'success' : 'neutral'}>
            {agent.isActive ? 'Active' : 'Inactive'}
          </Badge>
          {agent.isActive && (
            <Badge tone={agent.isAvailable ? 'success' : 'warning'}>
              {agent.isAvailable ? 'Available' : 'Paused'}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-bold text-charcoal">Edit details</h2>
          </CardHeader>
          <CardBody>
            <form action={updateAgent} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="agentId" value={agent.id} />
              <div>
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" defaultValue={agent.firstName} required />
              </div>
              <div>
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" defaultValue={agent.lastName} required />
              </div>
              <div className="col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={agent.email} required />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" defaultValue={agent.phone ?? ''} />
              </div>
              <div>
                <Label htmlFor="officeId">Office</Label>
                <Select id="officeId" name="officeId" defaultValue={agent.officeId ?? ''}>
                  <option value="">None</option>
                  {officeList.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="proximityAnchor">Measure distance from</Label>
                <Select
                  id="proximityAnchor"
                  name="proximityAnchor"
                  defaultValue={agent.proximityAnchor}
                >
                  <option value="office">Office</option>
                  <option value="custom">A city</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="radiusMiles">Accept within (mi)</Label>
                <Input
                  id="radiusMiles"
                  name="radiusMiles"
                  type="number"
                  min="1"
                  max={MAX_PROXIMITY_RADIUS_MILES}
                  step="1"
                  defaultValue={agent.proximityRadiusMiles ?? ''}
                  placeholder="Brokerage default"
                />
                <p className="mt-1 text-xs text-mute-light">
                  Max {MAX_PROXIMITY_RADIUS_MILES} mi (D22).
                  {isUnusuallyBroadRadius(agent.proximityRadiusMiles)
                    ? ' This agent covers an unusually wide area.'
                    : ''}
                </p>
              </div>
              <div className="col-span-2">
                <Label htmlFor="locationCity">City (used when anchor is “A city”)</Label>
                <Input
                  id="locationCity"
                  name="locationCity"
                  defaultValue={agent.locationCity ?? ''}
                  placeholder="e.g. Ann Arbor, MI"
                />
                {agent.proximityAnchor === 'custom' && agent.latitude == null ? (
                  <p className="mt-1 text-xs text-platinum-red">
                    City hasn&rsquo;t geocoded — routing falls back to the office anchor.
                  </p>
                ) : null}
              </div>
              <div className="col-span-2">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-bold text-charcoal">Status &amp; availability</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={agent.isActive ? 'success' : 'neutral'}>
                  {agent.isActive ? 'Active' : 'Inactive'}
                </Badge>
                {agent.isActive && (
                  <Badge tone={agent.isAvailable ? 'success' : 'warning'}>
                    {agent.isAvailable ? 'Available' : 'Paused'}
                  </Badge>
                )}
              </div>

              {/* Same two controls (and same server actions) as the agent tiles
                  on /admin/agents — availability incl. the first-activation credit. */}
              <form action={toggleAgentAvailable}>
                <input type="hidden" name="agentId" value={agent.id} />
                <input type="hidden" name="isAvailable" value={String(agent.isAvailable)} />
                <Button
                  type="submit"
                  variant={agent.isAvailable ? 'outline' : 'primary'}
                  className="w-full"
                >
                  {agent.isAvailable ? 'Pause new leads' : 'Resume new leads'}
                </Button>
              </form>

              <form action={toggleAgentActive}>
                <input type="hidden" name="agentId" value={agent.id} />
                <input type="hidden" name="isActive" value={String(agent.isActive)} />
                <Button
                  type="submit"
                  variant={agent.isActive ? 'danger' : 'primary'}
                  className="w-full"
                >
                  {agent.isActive ? 'Deactivate agent' : 'Activate agent'}
                </Button>
              </form>

              <p className="text-xs text-mute-light">
                Pausing stops new lead offers but keeps the agent active. Deactivating removes them
                from routing entirely.
              </p>
            </CardBody>
          </Card>

          {/* Account setup — the per-agent invite the Launch panel points at.
              The bulk Launch send runs once and its links expire in 7 days, so
              the agent who ignores the email for three weeks needs a fresh one;
              sendAgentInvite mints a new token and supersedes the old, which is
              why re-sending is always safe. */}
          <Card>
            <CardHeader>
              <h2 className="font-bold text-charcoal">Account setup</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {agent.passwordHash ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge tone="success">Set up</Badge>
                    <span className="text-sm text-mute">This agent can sign in.</span>
                  </div>
                  <p className="text-xs text-mute-light">
                    Setup invites are only for accounts with no password. If they&rsquo;re locked
                    out, they can use <strong>Forgot your password</strong> on the sign-in page,
                    or you can set one directly below.
                  </p>
                </>
              ) : !agent.isActive ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">Inactive</Badge>
                    <span className="text-sm text-mute">No password set.</span>
                  </div>
                  <p className="text-xs text-mute-light">
                    Activate this agent before sending a setup invite — invites are not issued to
                    inactive accounts.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning">Needs setup</Badge>
                    <span className="text-sm text-mute">
                      {agent.inviteSentAt ? (
                        <>
                          Invite sent <LocalTime value={agent.inviteSentAt} dateOnly />
                          {agent.inviteExpiresAt ? (
                            inviteLive ? (
                              <>
                                {' '}
                                · expires <LocalTime value={agent.inviteExpiresAt} dateOnly />
                              </>
                            ) : (
                              <>
                                {' '}
                                ·{' '}
                                <span className="font-semibold text-platinum-red">
                                  expired
                                </span>
                              </>
                            )
                          ) : null}
                        </>
                      ) : (
                        'No invite sent yet.'
                      )}
                    </span>
                  </div>

                  <form action={resendAgentInvite}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <Button type="submit" className="w-full">
                      {agent.inviteSentAt ? 'Send a new setup invite' : 'Send setup invite'}
                    </Button>
                  </form>

                  <p className="text-xs text-mute-light">
                    Emails a personal, single-use link to{' '}
                    <span className="font-semibold">{agent.email}</span>, good for 7 days. A new
                    invite <strong>replaces</strong> any earlier one, so their old link stops
                    working. If it doesn&rsquo;t arrive, check{' '}
                    <Link href="/admin/email-log" className="font-semibold text-platinum-blue hover:underline">
                      Email Log
                    </Link>
                    .
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-bold text-charcoal">Set password</h2>
            </CardHeader>
            <CardBody>
              <ResetOnSubmitForm action={setAgentPassword} className="flex items-end gap-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <div className="flex-1">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" name="password" type="password" minLength={8} required />
                </div>
                <Button type="submit">Set</Button>
              </ResetOnSubmitForm>
              <p className="mt-2 text-xs text-mute-light">
                {agent.passwordHash ? 'A password is currently set.' : 'No password set yet.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-bold text-charcoal">Manual score adjustment</h2>
            </CardHeader>
            <CardBody>
              <ResetOnSubmitForm action={adjustScore} className="space-y-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <div>
                  <Label htmlFor="delta">Delta (+/-)</Label>
                  <Input id="delta" name="delta" type="number" step="0.1" required />
                </div>
                <div>
                  <Label htmlFor="note">Reason (required)</Label>
                  <Textarea id="note" name="note" rows={2} required />
                </div>
                <Button type="submit">Apply adjustment</Button>
              </ResetOnSubmitForm>
            </CardBody>
          </Card>

        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Score log</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FBFAF6] text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-left">Reason</th>
                <th className="px-5 py-3 text-left">Delta</th>
                <th className="px-5 py-3 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {scoreLog.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-mute">
                    No score history.
                  </td>
                </tr>
              )}
              {scoreLog.map((row) => (
                <tr key={row.id} className="border-b border-line-hair last:border-0 hover:bg-offwhite">
                  <td className="px-5 py-3 text-mute-light">
                    {row.createdAt ? <LocalTime value={row.createdAt} /> : '—'}
                  </td>
                  <td className="px-5 py-3 text-charcoal">{row.reason}</td>
                  <td
                    className={`px-5 py-3 font-numeric font-bold ${
                      row.delta >= 0 ? 'text-success' : 'text-platinum-red'
                    }`}
                  >
                    {row.delta >= 0 ? '+' : ''}
                    {row.delta.toFixed(1)}
                  </td>
                  <td className="px-5 py-3 text-mute">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
