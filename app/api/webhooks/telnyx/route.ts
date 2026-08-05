/**
 * POST /api/webhooks/telnyx — inbound Telnyx webhook (design spec §6).
 *
 * The linchpin that lets agents act on leads by text. Verifies the Ed25519
 * signature (fail closed), records delivery receipts, logs every inbound
 * message, and dispatches parsed SMS commands (accept / decline / status /
 * stop / start / help) back through the shared domain helpers. Unknown senders
 * and unrecognized commands are forwarded to the owner by email.
 *
 * Always returns 200 after handling (Telnyx retries non-2xx) — the sole
 * exception is a failed signature check, which returns 401.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, leadOffers } from '@/drizzle/schema';
import { verifyTelnyxSignature } from '@/lib/telnyxSignature';
import { parseCommand } from '@/lib/smsCommands';
import { applyAccept, applyDecline } from '@/lib/offerActions';
import { recordStatusUpdate } from '@/lib/statusUpdates';
import { logSmsMessage, updateSmsStatusByTelnyxId } from '@/lib/smsMessages';
import { sendAgentSms } from '@/lib/agentSms';
import { helpText, optOutAckText } from '@/lib/smsTemplates';
import { toE164 } from '@/lib/sms';
import { sendEmail, adminAlertEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — liveness / URL-validation probe. Some providers (and uptime checks)
 * verify a webhook URL by issuing a GET and expecting a 2xx; without this they
 * get a 405 and may report the URL as "invalid." Carries no message payload and
 * mutates nothing, so it is safe to answer 200 without authentication. Real
 * message delivery is POST-only and still fully signature-gated below.
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: 'telnyx-webhook' });
}

// Agent shape used by the reply/dispatch helpers (subset of the row).
type AgentRow = typeof agents.$inferSelect;

export async function POST(req: NextRequest) {
  // 1. Signature gate — read the raw body BEFORE JSON-parsing, fail closed.
  const raw = await req.text();
  const ok = verifyTelnyxSignature({
    payload: raw,
    signatureB64: req.headers.get('telnyx-signature-ed25519') ?? '',
    timestamp: req.headers.get('telnyx-timestamp') ?? '',
    publicKeyB64: process.env.TELNYX_PUBLIC_KEY ?? '',
  });
  if (!ok) return new NextResponse('bad signature', { status: 401 });

  // Everything past the gate returns 200 even on an unexpected throw.
  try {
    return await handle(raw);
  } catch (err) {
    console.error('[webhooks/telnyx] unhandled error:', err);
    return NextResponse.json({ ok: true });
  }
}

async function handle(raw: string): Promise<NextResponse> {
  // 2. Parse JSON — malformed body is acknowledged (200) so Telnyx stops retrying.
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const data = evt?.data ?? {};
  const type: string = data.event_type ?? '';
  const payload = data.payload ?? {};

  // 3. Delivery receipts (DLR) — update the stored outbound row, then stop.
  if (type === 'message.sent' || type === 'message.finalized' || type === 'message.failed') {
    const id: string | undefined = payload.id;
    if (id) {
      const status =
        type === 'message.failed' ? 'failed' : payload.to?.[0]?.status ?? 'delivered';
      await updateSmsStatusByTelnyxId(id, status);
    }
    return NextResponse.json({ ok: true });
  }

  // 4. Only inbound messages are actionable.
  if (type !== 'message.received') return NextResponse.json({ ok: true });

  // 5. Extract inbound fields.
  const from: string = payload.from?.phone_number ?? '';
  const to: string = payload.to?.[0]?.phone_number ?? '';
  const text: string = payload.text ?? '';
  const providerId: string | undefined = payload.id;

  // 6. Identify the agent by normalized sender number; ALWAYS log the inbound.
  // Stored agent.phone values may be un-normalized (admin form doesn't enforce
  // E.164), so we can't push the comparison into SQL — load the (small) set of
  // agents with a phone on file and compare normalized forms in JS.
  const fromE164 = toE164(from) ?? from;
  const candidates = await db.select().from(agents).where(isNotNull(agents.phone));
  const agent = fromE164 ? (candidates.find((a) => toE164(a.phone) === fromE164) ?? null) : null;

  // Parse BEFORE logging so the stored row records whether we understood the
  // message. `inbound_unknown` is what makes "which wordings are agents using
  // that we don't support?" answerable in the admin SMS log — otherwise a failed
  // command is indistinguishable from a working one. `kind` is a varchar, not an
  // enum, so this needs no migration.
  //
  // Only an AGENT's wording is a command-vocabulary signal. A homeowner or LSA
  // caller texting in is ordinary inbound mail, not a failed command, so their
  // messages stay plain `inbound`.
  const cmd = agent ? parseCommand(text) : null;

  await logSmsMessage({
    direction: 'inbound',
    agentId: agent?.id ?? null,
    leadId: null,
    officeId: agent?.officeId ?? null,
    fromNumber: fromE164,
    toNumber: to,
    body: text,
    kind: cmd?.kind === 'unknown' ? 'inbound_unknown' : 'inbound',
    telnyxMessageId: providerId ?? null,
    status: 'received',
    errorMessage: null,
  });

  // 7. Unknown sender (no agent, e.g. homeowner/LSA inbound) — forward to owner.
  if (!agent || !cmd) {
    await sendEmail(
      adminAlertEmail('Unrecognized text to RE/MAX Platinum', `From ${from}:\n\n${text}`),
    );
    return NextResponse.json({ ok: true });
  }

  // 8. Dispatch the parsed command.

  if (cmd.kind === 'stop') {
    await db
      .update(agents)
      .set({ smsOptOut: true, smsOptOutAt: new Date() })
      .where(eq(agents.id, agent.id));
    await sendAgentSms({ agent, body: optOutAckText(), kind: 'optout_ack' });
    await sendEmail(
      adminAlertEmail(
        'Agent opted out of texts',
        `${agent.firstName} ${agent.lastName} (${fromE164}) sent STOP.`,
      ),
    );
    return NextResponse.json({ ok: true });
  }

  if (cmd.kind === 'start') {
    await db
      .update(agents)
      .set({ smsOptOut: false, smsOptOutAt: null })
      .where(eq(agents.id, agent.id));
    await sendAgentSms({
      agent: { ...agent, smsOptOut: false },
      body: "You're re-subscribed to RE/MAX Platinum lead texts.",
      kind: 'command_ack',
    });
    return NextResponse.json({ ok: true });
  }

  if (cmd.kind === 'help') {
    await sendAgentSms({ agent, body: helpText(), kind: 'help' });
    return NextResponse.json({ ok: true });
  }

  if (cmd.kind === 'unknown') {
    await sendEmail(
      adminAlertEmail('Unrecognized command from agent', `From ${from}:\n\n${text}`),
    );
    return NextResponse.json({ ok: true });
  }

  // 9 + 10. accept / decline / status — resolve the target offer, then act.
  const resolved = await resolveOffer(agent.id, cmd.code, cmd.codeExplicit, cmd.kind);
  if (!resolved.ok) {
    await sendAgentSms({ agent, body: resolved.message, kind: 'command_ack' });
    return NextResponse.json({ ok: true });
  }
  const { offerId, leadId, codeIgnored } = resolved;

  // A bare number that named none of this agent's leads was NOT a lead code, so
  // put it back where it came from rather than dropping it from the note.
  const notes = codeIgnored && cmd.code != null ? `${cmd.code} ${cmd.notes}`.trim() : cmd.notes;

  if (cmd.kind === 'accept') {
    const r = await applyAccept(offerId);
    // On success the client-info text (sent inside applyAccept) IS the reply —
    // no separate "Accepted lead" ack. Only speak up if it couldn't be accepted.
    if (!r.ok) await reply(agent, 'That lead is no longer available.');
  } else if (cmd.kind === 'decline') {
    const r = await applyDecline(offerId);
    await reply(
      agent,
      r.ok ? `Declined lead #${leadId}. Reassigning.` : 'That lead is no longer available.',
    );
  } else if (cmd.status === 'lost') {
    // Lost needs a stage-specific reason (v4 §6) that can't be chosen by text.
    await reply(agent, `To mark lead #${leadId} lost, open it in the portal — a reason is required.`);
  } else {
    // cmd.kind === 'status'
    const r = await recordStatusUpdate({
      agentId: agent.id,
      leadOfferId: offerId,
      newStatus: cmd.status,
      note: notes || null,
      source: 'phone',
    });
    await reply(agent, statusReply(r, leadId, cmd.status));
  }

  // 11. Acknowledge.
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort outbound reply from the agent's office number. */
async function reply(agent: AgentRow, body: string): Promise<void> {
  await sendAgentSms({ agent, body, kind: 'command_ack' });
}

/** Map a recordStatusUpdate result to the agent-facing reply text. */
function statusReply(
  r: Awaited<ReturnType<typeof recordStatusUpdate>>,
  leadId: number,
  status: string,
): string {
  if (r.ok) return `Updated lead #${leadId} → ${status.replace('_', ' ')}.`;
  switch (r.reason) {
    case 'invalid-status':
      return "That status can't be set by text.";
    case 'invalid-transition':
      return `That move isn't allowed for lead #${leadId} from its current stage.`;
    case 'lost-reason-required':
      return `To mark #${leadId} lost, include a valid reason for its current stage.`;
    case 'offer-not-found':
      return 'That lead is no longer active.';
    default:
      return 'Could not update that lead.';
  }
}

type ResolveResult =
  | { ok: true; offerId: number; leadId: number; codeIgnored: boolean }
  | { ok: false; message: string };

/**
 * Resolve which offer a command targets for this agent.
 * - accept/decline → an outstanding `offered` row (optionally matching lead #code).
 * - status → an `accepted` (active) row (optionally matching lead #code).
 *
 * A PARSED CODE IS ONLY A CANDIDATE. This used to push the code straight into
 * the SQL as `leadOffers.leadId = code`, which meant an unparseable or mistyped
 * number simply produced a filter that matched nothing — and the caller then
 * fell back to the agent's single active lead. Combined with the phrase bug that
 * dropped lead ids ("ATTEMPTED CONTACT 53"), an agent could believe they had
 * updated #53 while a different lead was actually changed.
 *
 * Now the agent's own offers are loaded first and the code is checked against
 * them, which is the only definition of a valid lead id that matters here:
 *   - matches one of theirs           → act on it.
 *   - explicit `#53` matching nothing → say so; they named a specific lead.
 *   - bare number matching nothing    → it was never a lead id. Ignore it as a
 *                                       code (the caller folds it back into the
 *                                       note) and fall through to the normal
 *                                       one-candidate / disambiguate path.
 * Authorization is unchanged and unconditional: only this agent's rows are ever
 * loaded, so no code can reach another agent's lead.
 */
async function resolveOffer(
  agentId: number,
  code: number | null,
  codeExplicit: boolean,
  kind: 'accept' | 'decline' | 'status',
): Promise<ResolveResult> {
  const targetStatus = kind === 'status' ? 'accepted' : 'offered';
  const rows = await db
    .select({ id: leadOffers.id, leadId: leadOffers.leadId })
    .from(leadOffers)
    .where(and(eq(leadOffers.agentId, agentId), eq(leadOffers.status, targetStatus)));

  if (code != null) {
    const matched = rows.filter((r) => r.leadId === code);
    if (matched.length === 1) {
      return { ok: true, offerId: matched[0].id, leadId: matched[0].leadId, codeIgnored: false };
    }
    if (codeExplicit) {
      return {
        ok: false,
        message:
          kind === 'status'
            ? `No active lead found for #${code}.`
            : `No open lead offer found for #${code}.`,
      };
    }
    // Bare number, not one of theirs — treat it as message text, not a code.
  }

  if (rows.length === 1) {
    return { ok: true, offerId: rows[0].id, leadId: rows[0].leadId, codeIgnored: code != null };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      message: kind === 'status' ? 'No active lead found.' : 'No open lead offer found.',
    };
  }

  // More than one, and no usable code to disambiguate. The example must be a
  // command the parser actually accepts — this said "CONTACTED", which v4
  // renamed to Connected and which parsed as unknown, so an agent following the
  // prompt verbatim got silence and the owner got an alert email.
  const message =
    kind === 'status'
      ? 'You have multiple active leads — reply e.g. CONNECTED <lead#>.'
      : 'You have multiple open offers — reply e.g. YES <lead#>.';
  return { ok: false, message };
}
