/**
 * Send an SMS to an agent from their home-office number, gated on opt-out and
 * config, logging every attempt. Email is the source of truth — this never
 * throws (design spec §5/§8/§9).
 */
import { sendSms, toE164 } from './sms';
import { pickOfficeNumber } from './officeNumbers';
import { logSmsMessage } from './smsMessages';
import { db } from './db';
import { offices } from '../drizzle/schema';

export function shouldSendAgentSms(agent: { smsOptOut: boolean | null; phone: string | null }): boolean {
  return !agent.smsOptOut && !!agent.phone;
}

async function officeNumberMap(): Promise<Map<number, string | null>> {
  const rows = await db.select({ id: offices.id, telnyxNumber: offices.telnyxNumber }).from(offices);
  return new Map(rows.map((r) => [r.id, r.telnyxNumber]));
}

export async function sendAgentSms(o: {
  agent: { id: number; phone: string | null; officeId: number | null; smsOptOut: boolean | null };
  body: string;
  kind: string;
  leadId?: number | null;
}): Promise<void> {
  try {
    if (!process.env.TELNYX_API_KEY) return;
    if (!shouldSendAgentSms(o.agent)) return;

    const numbers = await officeNumberMap();
    const from = pickOfficeNumber({
      officeId: o.agent.officeId,
      numbersByOfficeId: numbers,
      defaultNumber: process.env.TELNYX_DEFAULT_FROM ?? null,
    });
    if (!from) return; // no office number configured — email still sent by caller

    const officeId = o.agent.officeId ?? null;
    const res = await sendSms(o.agent.phone, o.body, { from });
    await logSmsMessage({
      direction: 'outbound',
      agentId: o.agent.id,
      leadId: o.leadId ?? null,
      officeId,
      fromNumber: from,
      toNumber: toE164(o.agent.phone) ?? o.agent.phone ?? '',
      body: o.body,
      kind: o.kind,
      telnyxMessageId: res.telnyxMessageId ?? null,
      status: res.sent ? 'sent' : 'failed',
      errorMessage: res.error ?? null,
    });
  } catch (err) {
    console.error('[agentSms] send failed:', err);
  }
}
