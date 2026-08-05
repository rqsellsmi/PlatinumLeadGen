import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { smsMessages, agents, offices } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { toE164 } from '@/lib/sms';
import { parseCommand } from '@/lib/smsCommands';

export const dynamic = 'force-dynamic';

/**
 * Admin-only SMS / Telnyx diagnostic. The sms_messages table otherwise has no
 * UI, so a "no text arrived" test is blind. This shows the live Telnyx config
 * for THIS environment, each agent's texting eligibility (phone + opt-out), and
 * the most recent messages with their status/error — enough to tell whether a
 * send dropped at a config gate, was rejected by Telnyx, or left our system.
 */
function envState(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? 'set' : 'MISSING';
}

export default async function AdminSmsLogPage() {
  await requireAdmin();

  const apiKey = envState('TELNYX_API_KEY');
  const publicKey = envState('TELNYX_PUBLIC_KEY');
  const defaultFrom = (process.env.TELNYX_DEFAULT_FROM ?? '').trim();
  const messagingProfile = envState('TELNYX_MESSAGING_PROFILE_ID');

  let officeRows: { id: number; name: string; telnyxNumber: string | null }[] = [];
  let officeError = '';
  try {
    officeRows = await db
      .select({ id: offices.id, name: offices.name, telnyxNumber: offices.telnyxNumber })
      .from(offices)
      .orderBy(offices.name);
  } catch (e) {
    officeError = e instanceof Error ? e.message : 'unknown';
  }
  const officesWithNumber = officeRows.filter((o) => o.telnyxNumber && o.telnyxNumber.trim()).length;

  let agentRows: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    smsOptOut: boolean | null;
    isActive: boolean | null;
    isAvailable: boolean | null;
  }[] = [];
  let agentError = '';
  try {
    agentRows = await db
      .select({
        id: agents.id,
        firstName: agents.firstName,
        lastName: agents.lastName,
        phone: agents.phone,
        smsOptOut: agents.smsOptOut,
        isActive: agents.isActive,
        isAvailable: agents.isAvailable,
      })
      .from(agents)
      .orderBy(agents.firstName);
  } catch (e) {
    agentError = e instanceof Error ? e.message : 'unknown';
  }

  let messages: (typeof smsMessages.$inferSelect)[] = [];
  let msgError = '';
  let totalMessages = 0;
  try {
    messages = await db.select().from(smsMessages).orderBy(desc(smsMessages.createdAt)).limit(25);
    const c = await db.select({ n: sql<number>`count(*)::int` }).from(smsMessages);
    totalMessages = Number(c[0]?.n ?? 0);
  } catch (e) {
    msgError = e instanceof Error ? e.message : 'unknown';
  }

  // Wordings agents tried that the command parser did not recognize, grouped by
  // the leading phrase. This is the feedback loop for lib/smsCommands.ts: a
  // phrase showing up repeatedly here is one worth adding to STATUS_PHRASES.
  // Grouped in the page rather than in SQL — a brokerage produces tens of these,
  // not millions, and reusing the real parser keeps the grouping identical to
  // the matching logic.
  let unknownGroups: { phrase: string; count: number; lastSeen: Date | null; example: string }[] = [];
  let unknownError = '';
  try {
    const rows = await db
      .select({ body: smsMessages.body, createdAt: smsMessages.createdAt })
      .from(smsMessages)
      .where(eq(smsMessages.kind, 'inbound_unknown'))
      .orderBy(desc(smsMessages.createdAt))
      .limit(500);
    const byPhrase = new Map<string, { count: number; lastSeen: Date | null; example: string }>();
    for (const r of rows) {
      const parsed = parseCommand(r.body);
      const phrase =
        (parsed.kind === 'unknown' ? parsed.phrase : '').trim() || '(no leading words)';
      const cur = byPhrase.get(phrase);
      if (cur) cur.count += 1;
      // Rows arrive newest-first, so the first one seen is the latest example.
      else byPhrase.set(phrase, { count: 1, lastSeen: r.createdAt, example: r.body });
    }
    unknownGroups = [...byPhrase.entries()]
      .map(([phrase, v]) => ({ phrase, ...v }))
      .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
      .slice(0, 20);
  } catch (e) {
    unknownError = e instanceof Error ? e.message : 'unknown';
  }

  function fmt(d: Date | null): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
    } catch {
      return String(d);
    }
  }

  const statusTone: Record<string, string> = {
    sent: 'text-success',
    delivered: 'text-success',
    received: 'text-charcoal',
    failed: 'text-platinum-red',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">SMS / Telnyx diagnostics</h1>
        <p className="text-sm text-mute">
          Live texting config for <span className="font-semibold">this</span> deployment, agent
          eligibility, and the most recent messages. If a test text never arrives, read this
          top-to-bottom: config gate → agent phone → message row status.
        </p>
      </div>

      {/* Config */}
      <div className="rounded-card border border-line bg-white p-5 text-sm">
        <p className="mb-3 font-bold text-charcoal">Telnyx configuration</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              TELNYX_API_KEY (enables sending)
            </dt>
            <dd className={`font-mono ${apiKey === 'set' ? 'text-success' : 'text-platinum-red'}`}>
              {apiKey}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              TELNYX_PUBLIC_KEY (inbound webhook)
            </dt>
            <dd className={`font-mono ${publicKey === 'set' ? 'text-success' : 'text-platinum-red'}`}>
              {publicKey}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              TELNYX_DEFAULT_FROM (fallback from-number)
            </dt>
            <dd
              className={`font-mono ${defaultFrom ? 'text-charcoal' : 'text-platinum-red'}`}
            >
              {defaultFrom || 'MISSING'}
              {defaultFrom && !defaultFrom.startsWith('+') ? (
                <span className="ml-2 text-platinum-red">(not E.164 — needs a leading +1)</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-lighter">
              TELNYX_MESSAGING_PROFILE_ID (optional)
            </dt>
            <dd className="font-mono text-charcoal">{messagingProfile}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-mute-light">
          A send needs <span className="font-semibold">TELNYX_API_KEY</span> plus a from-number —
          either the agent&apos;s office <span className="font-mono">telnyx_number</span> or{' '}
          <span className="font-mono">TELNYX_DEFAULT_FROM</span>. Offices with a number:{' '}
          <span className="font-semibold">{officesWithNumber}</span> of {officeRows.length}.
        </p>
      </div>

      {/* Offices */}
      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="border-b border-line bg-[#FBFAF6] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
          Office from-numbers
        </div>
        {officeError ? (
          <p className="px-5 py-3 font-mono text-sm text-platinum-red">error: {officeError}</p>
        ) : (
          <table className="min-w-full text-sm">
            <tbody>
              {officeRows.map((o) => (
                <tr key={o.id} className="border-b border-line-hair last:border-0">
                  <td className="px-5 py-2.5 text-charcoal">{o.name}</td>
                  <td className="px-5 py-2.5 font-mono text-charcoal">
                    {o.telnyxNumber && o.telnyxNumber.trim() ? (
                      o.telnyxNumber
                    ) : (
                      <span className="text-mute-light">— (uses TELNYX_DEFAULT_FROM)</span>
                    )}
                  </td>
                </tr>
              ))}
              {officeRows.length === 0 ? (
                <tr>
                  <td className="px-5 py-3 text-mute">No offices.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      {/* Agents */}
      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="border-b border-line bg-[#FBFAF6] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
          Agent texting eligibility
        </div>
        {agentError ? (
          <p className="px-5 py-3 font-mono text-sm text-platinum-red">error: {agentError}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                  <th className="px-5 py-2.5 text-left">Agent</th>
                  <th className="px-5 py-2.5 text-left">Phone (stored)</th>
                  <th className="px-5 py-2.5 text-left">Normalizes to</th>
                  <th className="px-5 py-2.5 text-left">Opt-out</th>
                  <th className="px-5 py-2.5 text-left">Active</th>
                  <th className="px-5 py-2.5 text-left">Available</th>
                  <th className="px-5 py-2.5 text-left">Will text?</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((a) => {
                  const hasPhone = !!(a.phone && a.phone.trim());
                  const normalized = toE164(a.phone);
                  const willText = hasPhone && !a.smsOptOut;
                  return (
                    <tr key={a.id} className="border-b border-line-hair last:border-0">
                      <td className="px-5 py-2.5 text-charcoal">
                        {`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || `#${a.id}`}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-charcoal">
                        {hasPhone ? a.phone : <span className="text-platinum-red">— none</span>}
                      </td>
                      <td className="px-5 py-2.5 font-mono">
                        {normalized ? (
                          <span className="text-charcoal">{normalized}</span>
                        ) : hasPhone ? (
                          <span className="text-platinum-red">unparseable</span>
                        ) : (
                          <span className="text-mute-light">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 font-mono">
                        {a.smsOptOut ? (
                          <span className="text-platinum-red">OPTED OUT</span>
                        ) : (
                          <span className="text-mute-light">no</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-charcoal">{a.isActive ? 'yes' : 'no'}</td>
                      <td className="px-5 py-2.5 font-mono text-charcoal">
                        {a.isAvailable ? 'yes' : 'no'}
                      </td>
                      <td className="px-5 py-2.5 font-mono">
                        {willText ? (
                          <span className="text-success">yes</span>
                        ) : (
                          <span className="text-platinum-red">no</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {agentRows.length === 0 ? (
                  <tr>
                    <td className="px-5 py-3 text-mute" colSpan={7}>
                      No agents.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unrecognized wordings */}
      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="border-b border-line bg-[#FBFAF6] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
          Unrecognized wordings from agents
        </div>
        {unknownError ? (
          <p className="px-5 py-3 font-mono text-sm text-platinum-red">error: {unknownError}</p>
        ) : unknownGroups.length === 0 ? (
          <p className="px-5 py-4 text-sm text-mute">
            Nothing yet — every agent text so far parsed into a command.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                    <th className="px-5 py-2.5 text-left">Leading phrase</th>
                    <th className="px-5 py-2.5 text-left">Times</th>
                    <th className="px-5 py-2.5 text-left">Last seen (ET)</th>
                    <th className="px-5 py-2.5 text-left">Latest message</th>
                  </tr>
                </thead>
                <tbody>
                  {unknownGroups.map((g) => (
                    <tr key={g.phrase} className="border-b border-line-hair align-top last:border-0">
                      <td className="px-5 py-2.5 font-mono font-bold text-charcoal">{g.phrase}</td>
                      <td className="px-5 py-2.5 font-numeric text-charcoal">{g.count}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-mute-light">
                        {fmt(g.lastSeen)}
                      </td>
                      <td className="max-w-xs px-5 py-2.5 text-charcoal">{g.example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line-hair px-5 py-3 text-xs text-mute-light">
              A phrase appearing repeatedly is one agents expect to work. Add it to{' '}
              <span className="font-mono">STATUS_PHRASES</span> in{' '}
              <span className="font-mono">lib/smsCommands.ts</span> and it starts parsing — no
              migration needed.
            </p>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line bg-[#FBFAF6] px-5 py-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
            Recent messages (latest 25 of {totalMessages})
          </span>
        </div>
        {msgError ? (
          <p className="px-5 py-3 font-mono text-sm text-platinum-red">error: {msgError}</p>
        ) : messages.length === 0 ? (
          <p className="px-5 py-4 text-sm text-mute">
            No SMS rows yet. If you just submitted a lead and expected a text, the send dropped at a
            config gate <span className="font-semibold">before</span> logging (no API key, agent has
            no phone / opted out, or no from-number) — check the panels above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] font-bold uppercase tracking-[0.06em] text-mute-light">
                  <th className="px-4 py-2.5 text-left">When (ET)</th>
                  <th className="px-4 py-2.5 text-left">Dir</th>
                  <th className="px-4 py-2.5 text-left">Kind</th>
                  <th className="px-4 py-2.5 text-left">From → To</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-left">Error</th>
                  <th className="px-4 py-2.5 text-left">Body</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} className="border-b border-line-hair align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-mute-light">{fmt(m.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-charcoal">{m.direction}</td>
                    <td className="px-4 py-2.5 font-mono text-charcoal">{m.kind}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-charcoal">
                      {m.fromNumber} → {m.toNumber}
                    </td>
                    <td className={`px-4 py-2.5 font-mono ${statusTone[m.status] ?? 'text-charcoal'}`}>
                      {m.status}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-platinum-red">{m.errorMessage ?? '—'}</td>
                    <td className="max-w-xs px-4 py-2.5 text-charcoal">{m.body}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
