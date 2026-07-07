/**
 * Cron: score-track maintenance (spec v2 §1/§5). Runs daily.
 *  - Recomputes every agent's rolling-90d from the log (so aging events decay
 *    out of the trailing-90-day window even without a new scoring event).
 *  - Resets score_monthly on the first run of a new calendar month, and
 *    score_ytd on the first run of a new year — each guarded by a stored period
 *    key so it fires exactly once per boundary. On the very first run the key is
 *    simply adopted (no reset), so the bootstrapped values survive until the
 *    next real boundary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, notificationSettings } from '@/drizzle/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7); // YYYY-MM
    const yearKey = now.toISOString().slice(0, 4); // YYYY

    // 1. Decay rolling-90d for every agent from the log (single statement).
    await db.execute(sql`
      UPDATE ${agents} SET score_rolling_90d = COALESCE((
        SELECT SUM(l.delta) FROM agent_score_log l
        WHERE l.agent_id = ${agents}.id
          AND l.created_at >= now() - interval '90 days'
      ), 0)
    `);

    // 2. Periodic resets, guarded by stored keys.
    const rows = await db
      .select({
        id: notificationSettings.id,
        monthlyKey: notificationSettings.scoreMonthlyResetKey,
        ytdKey: notificationSettings.scoreYtdResetKey,
      })
      .from(notificationSettings)
      .limit(1);
    let settingsId = rows[0]?.id ?? null;
    if (settingsId == null) {
      const inserted = await db.insert(notificationSettings).values({}).returning({ id: notificationSettings.id });
      settingsId = inserted[0].id;
    }

    let monthlyReset = false;
    let ytdReset = false;
    const prevMonthly = rows[0]?.monthlyKey ?? null;
    const prevYtd = rows[0]?.ytdKey ?? null;

    if (prevMonthly !== monthKey) {
      // Adopt on first run (null); otherwise a new month → reset.
      if (prevMonthly != null) {
        await db.update(agents).set({ scoreMonthly: 0 });
        monthlyReset = true;
      }
    }
    if (prevYtd !== yearKey) {
      if (prevYtd != null) {
        await db.update(agents).set({ scoreYtd: 0 });
        ytdReset = true;
      }
    }

    await db
      .update(notificationSettings)
      .set({ scoreMonthlyResetKey: monthKey, scoreYtdResetKey: yearKey, updatedAt: now })
      .where(eq(notificationSettings.id, settingsId));

    return NextResponse.json({ ok: true, monthlyReset, ytdReset });
  } catch (err) {
    console.error('[cron/score-maintenance] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
