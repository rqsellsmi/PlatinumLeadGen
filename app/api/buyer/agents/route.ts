/**
 * GET /api/buyer/agents — the active-agent roster for the buyer representation
 * picker ("Is it one of these RE/MAX Platinum agents?"). Returns id + display
 * name only (nickname when set, else legal name) — no contact details. Requires
 * a buyer session so it isn't a public agent directory.
 */
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { getBuyerUserId } from '@/lib/buyerSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const buyerId = await getBuyerUserId();
  if (!buyerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await db
    .select({
      id: agents.id,
      displayName: agents.displayName,
      firstName: agents.firstName,
      lastName: agents.lastName,
    })
    .from(agents)
    .where(eq(agents.isActive, true))
    .orderBy(asc(agents.firstName), asc(agents.lastName));

  const list = rows
    .map((a) => ({ id: a.id, name: (a.displayName?.trim() || `${a.firstName} ${a.lastName}`).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ agents: list });
}
