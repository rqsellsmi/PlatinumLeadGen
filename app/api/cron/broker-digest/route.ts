/**
 * Cron: Thursday broker digest of all accepted leads. (Section 8)
 * Runs weekly Thursday 13:00 UTC.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leadOffers, leads, agents } from '@/drizzle/schema';
import { sendEmail, brokerDigestEmail, type DigestRow } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
}

export async function GET(req: NextRequest) {
  try {
    if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const now = new Date();

    const accepted = await db
      .select({ offer: leadOffers, lead: leads, agent: agents })
      .from(leadOffers)
      .innerJoin(leads, eq(leadOffers.leadId, leads.id))
      .innerJoin(agents, eq(leadOffers.agentId, agents.id))
      .where(eq(leadOffers.status, 'accepted'));

    const rows: DigestRow[] = accepted.map((r) => {
      const acceptedAt = r.lead.acceptedAt ?? r.offer.acceptedAt;
      const daysSinceAccept = acceptedAt
        ? Math.floor((now.getTime() - acceptedAt.getTime()) / DAY_MS)
        : 0;
      const leadName = `${r.lead.firstName ?? ''} ${r.lead.lastName ?? ''}`.trim() || 'New lead';
      return {
        agentName: `${r.agent.firstName} ${r.agent.lastName}`.trim(),
        leadName,
        daysSinceAccept,
        status: r.lead.status,
      };
    });

    await sendEmail(brokerDigestEmail(rows, `${siteUrl()}/admin`));

    return NextResponse.json({ rows: rows.length });
  } catch (err) {
    console.error('[cron/broker-digest] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
