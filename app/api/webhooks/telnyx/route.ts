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

  await logSmsMessage({
    direction: 'inbound',
    agentId: agent?.id ?? null,
    leadId: null,
    officeId: agent?.officeId ?? null,
    fromNumber: fromE164,
    toNumber: to,
    body: text,
    kind: 'inbound',
    telnyxMessageId: providerId ?? null,
    status: 'received',
    errorMessage: null,
  });

  // 7. Unknown sender (no agent, e.g. homeowner/LSA inbound) — forward to owner.
  if (!agent) {
    await sendEmail(
      adminAlertEmail('Unrecognized text to RE/MAX Platinum', `From ${from}:\n\n${text}`),
    );
    return NextResponse.json({ ok: true });
  }

  // 8. Parse and dispatch the command.
  const cmd = parseCommand(text);

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
  const resolved = await resolveOffer(agent.id, cmd.code, cmd.kind);
  if (!resolved.ok) {
    await sendAgentSms({ agent, body: resolved.message, kind: 'command_ack' });
    return NextResponse.json({ ok: true });
  }
  const { offerId, leadId } = resolved;

  if (cmd.kind === 'accept') {
    const r = await applyAccept(offerId);
    await reply(agent, r.ok ? `Accepted lead #${leadId}.` : 'That lead is no longer available.');
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
      note: cmd.notes || null,
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
  | { ok: true; offerId: number; leadId: number }
  | { ok: false; message: string };

/**
 * Resolve which offer a command targets for this agent.
 * - accept/decline → an outstanding `offered` row (optionally matching lead #code).
 * - status → an `accepted` (active) row (optionally matching lead #code).
 * Exactly one candidate → success; none → not-found message; many (no code) →
 * disambiguation prompt.
 */
async function resolveOffer(
  agentId: number,
  code: number | null,
  kind: 'accept' | 'decline' | 'status',
): Promise<ResolveResult> {
  const targetStatus = kind === 'status' ? 'accepted' : 'offered';
  const conds = [eq(leadOffers.agentId, agentId), eq(leadOffers.status, targetStatus)];
  if (code != null) conds.push(eq(leadOffers.leadId, code));

  const rows = await db
    .select({ id: leadOffers.id, leadId: leadOffers.leadId })
    .from(leadOffers)
    .where(and(...conds));

  if (rows.length === 1) return { ok: true, offerId: rows[0].id, leadId: rows[0].leadId };

  if (rows.length === 0) {
    const suffix = code != null ? ` for #${code}` : '';
    const message =
      kind === 'status'
        ? `No active lead found${suffix}.`
        : `No open lead offer found${suffix}.`;
    return { ok: false, message };
  }

  // More than one, and no code to disambiguate.
  const message =
    kind === 'status'
      ? 'You have multiple active leads — reply e.g. CONTACTED <lead#>.'
      : 'You have multiple open offers — reply e.g. YES <lead#>.';
  return { ok: false, message };
}
