/**
 * Client-info SMS — sent to the agent any time they take ownership of a lead
 * (web accept, and manual/admin assignment). Lives in its own module so both
 * `offerActions.ts` and `autoOffer.ts` can import it without creating a cycle
 * (offerActions -> autoOffer, both -> clientInfoSms).
 */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { leads, agents } from '../drizzle/schema';
import { sendAgentSms } from './agentSms';
import { clientInfoText } from './smsTemplates';
import { siteUrl } from './siteUrl';

export async function sendClientInfoSms(leadId: number, agentId: number, leadOfferId: number): Promise<void> {
  try {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!lead || !agent) return;
    const leadUrl = `${siteUrl()}/agent/leads/${leadOfferId}`;
    await sendAgentSms({
      agent,
      kind: 'lead_details',
      leadId,
      body: clientInfoText({
        leadId,
        firstName: lead.firstName ?? null,
        lastName: lead.lastName ?? null,
        phone: lead.phone ?? null,
        email: lead.email ?? null,
        address: lead.propertyAddress ?? null,
        city: lead.propertyCity ?? null,
        estimate: lead.estimatedValue ?? null,
        leadUrl,
      }),
    });
  } catch (err) {
    console.error('[clientInfoSms] send failed:', err);
  }
}
