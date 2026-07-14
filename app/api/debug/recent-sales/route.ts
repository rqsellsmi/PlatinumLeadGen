/**
 * TEMPORARY diagnostic — remove after debugging the homepage recent-sales issue.
 * Reports what the RUNNING deployment actually sees: which DB host it connects
 * to, whether its live REALCOMP_OFFICE_KEYS include the office in question, what
 * the homepage's own getFeaturedRecentSales() returns, and the Torrey row
 * straight from the DB. Secret-gated so it isn't public.
 *
 *   GET /api/debug/recent-sales?secret=<CRON_SECRET>
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { idxListings } from '@/drizzle/schema';
import { parseOfficeKeys } from '@/lib/idxSync';
import { getFeaturedRecentSales } from '@/lib/queries';
import { resolveDatabaseUrl } from '@/lib/dbUrl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dbUrl = resolveDatabaseUrl();
  // Host only (no credentials) — reveals which Neon branch endpoint is in use.
  const dbHost = dbUrl ? dbUrl.match(/@([^/?]+)/)?.[1] ?? 'parse-failed' : 'none';

  const keys = parseOfficeKeys();

  let recentSales: unknown = null;
  let recentSalesError: string | null = null;
  try {
    const rows = await getFeaturedRecentSales(8);
    recentSales = rows.map((r) => ({
      address: r.address,
      closeDate: r.closeDate,
      listingKey: r.listingKey, // non-null ⇒ IDX row; null ⇒ CSV closings fallback
    }));
  } catch (e) {
    recentSalesError = e instanceof Error ? e.message : String(e);
  }

  let torreyRows: unknown = null;
  try {
    const rows = await db
      .select({
        address: idxListings.address,
        closeDate: idxListings.closeDate,
        standardStatus: idxListings.standardStatus,
        listOfficeKey: idxListings.listOfficeKey,
        coListOfficeKey: idxListings.coListOfficeKey,
        buyerOfficeKey: idxListings.buyerOfficeKey,
        hasPhoto: idxListings.photoUrl,
        propertyType: idxListings.propertyType,
      })
      .from(idxListings)
      .where(eq(idxListings.address, '12147 Torrey Road'));
    torreyRows = rows.map((r) => ({ ...r, hasPhoto: r.hasPhoto != null }));
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    dbHost,
    keysCount: keys.length,
    has_25248113: keys.includes('25248113'),
    has_252481: keys.includes('252481'),
    recentSalesError,
    recentSales,
    torreyRows,
    now: new Date().toISOString(),
  });
}
