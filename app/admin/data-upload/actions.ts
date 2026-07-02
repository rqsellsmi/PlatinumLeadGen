'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { closings, uploadBatches } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import { parseClosingsCsv, type AgentRole } from '@/lib/csvClosings';
import { updateAllMetrics, resetAllMetrics, closeDateRange } from '@/lib/metrics';

export interface UploadSummary {
  ok: boolean;
  batchId?: number;
  imported: number;
  skipped: number;
  errored: number;
  errors: string[];
  message: string;
}

/**
 * Import a closings CSV (§A.3). MLS dedup is per agentRole; rows missing
 * required fields are skipped with an error. Writes an upload_batches row and
 * recomputes metrics.
 */
export async function uploadClosings(
  agentRole: AgentRole,
  csvText: string,
  fileName: string,
): Promise<UploadSummary> {
  await requireAdmin();
  if (agentRole !== 'listing' && agentRole !== 'buyer') {
    return { ok: false, imported: 0, skipped: 0, errored: 0, errors: ['Invalid role'], message: 'Invalid role' };
  }

  const { rows, errors } = parseClosingsCsv(csvText, agentRole);
  const errored = errors.length;

  // Existing MLS numbers for this role (dedup key per agentRole).
  const existing = await db
    .select({ mls: closings.mlsNumber })
    .from(closings)
    .where(eq(closings.agentRole, agentRole));
  const seen = new Set(
    existing.map((r) => (r.mls ?? '').trim().toLowerCase()).filter(Boolean),
  );

  const toInsert: typeof rows = [];
  let skipped = 0;
  for (const row of rows) {
    const mls = row.mlsNumber?.trim().toLowerCase();
    if (mls) {
      if (seen.has(mls)) {
        skipped += 1;
        continue;
      }
      seen.add(mls); // also dedup within the same file
    }
    toInsert.push(row);
  }

  const { earliest, latest } = closeDateRange(toInsert);

  const batchRows = await db
    .insert(uploadBatches)
    .values({
      agentRole,
      fileName: fileName.slice(0, 500),
      rowsImported: toInsert.length,
      rowsSkipped: skipped,
      rowsErrored: errored,
      earliestCloseDate: earliest,
      latestCloseDate: latest,
    })
    .returning({ id: uploadBatches.id });
  const batchId = batchRows[0].id;

  if (toInsert.length > 0) {
    await db.insert(closings).values(
      toInsert.map((r) => ({
        mlsNumber: r.mlsNumber,
        agentRole: r.agentRole,
        closeDate: r.closeDate,
        listPrice: r.listPrice,
        salePrice: r.salePrice,
        daysOnMarket: r.daysOnMarket,
        address: r.address,
        city: r.city,
        state: r.state,
        zipCode: r.zipCode,
        propertyType: r.propertyType,
        agentName: r.agentName,
        schoolDistrict: r.schoolDistrict,
        percentOfListPrice: r.percentOfListPrice,
        uploadBatchId: batchId,
      })),
    );
  }

  await updateAllMetrics();
  revalidatePath('/admin/data-upload');

  return {
    ok: true,
    batchId,
    imported: toInsert.length,
    skipped,
    errored,
    errors: errors.slice(0, 50),
    message: `Imported ${toInsert.length}, skipped ${skipped} duplicates, ${errored} errored.`,
  };
}

/** Return the closings for a batch (for expanding a batch row). */
export async function getClosingsByBatch(batchId: number) {
  await requireAdmin();
  return db
    .select()
    .from(closings)
    .where(eq(closings.uploadBatchId, batchId))
    .orderBy(closings.closeDate);
}

export async function deleteBatch(formData: FormData) {
  await requireAdmin();
  const batchId = Number(formData.get('batchId'));
  if (!batchId) throw new Error('Invalid batch');
  // closings cascade-delete via FK; delete the batch row.
  await db.delete(closings).where(eq(closings.uploadBatchId, batchId));
  await db.delete(uploadBatches).where(eq(uploadBatches.id, batchId));
  await updateAllMetrics();
  revalidatePath('/admin/data-upload');
}

export async function deleteAllClosings() {
  await requireAdmin();
  const batchIds = await db.select({ id: uploadBatches.id }).from(uploadBatches);
  await db.delete(closings);
  if (batchIds.length > 0) {
    await db.delete(uploadBatches).where(inArray(uploadBatches.id, batchIds.map((b) => b.id)));
  }
  await resetAllMetrics();
  revalidatePath('/admin/data-upload');
}

/** Manual "Update Metrics" button. */
export async function recomputeMetrics(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const r = await updateAllMetrics();
  revalidatePath('/admin/data-upload');
  revalidatePath('/', 'page');
  revalidatePath('/sell/[slug]', 'page');
  return {
    ok: true,
    message: `Recomputed from ${r.totalClosings} closings across ${r.locationsUpdated} locations.`,
  };
}
