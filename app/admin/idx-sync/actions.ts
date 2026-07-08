'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { runIdxSync } from '@/lib/idxSync';
import { realcompFetch, isRealcompConfigured } from '@/lib/realcomp';

export interface RunSyncResult {
  ok: boolean;
  message: string;
}

/**
 * Manually trigger an incremental IDX sync from the admin (IDX spec §2.7).
 * Uses admin auth — no CRON_SECRET required.
 */
export async function runSyncNow(): Promise<RunSyncResult> {
  await requireAdmin();
  if (!isRealcompConfigured()) {
    return { ok: false, message: 'Realcomp is not configured (REALCOMP_CLIENT_ID / SECRET).' };
  }
  try {
    const r = await runIdxSync((path, params) => realcompFetch(path, params));
    revalidatePath('/admin/idx-sync');
    return {
      ok: true,
      message: `Sync complete — Q1: ${r.query1Upserted}/${r.query1Fetched}, Q2: ${r.query2Upserted}/${r.query2Fetched} upserted.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Sync failed.' };
  }
}
