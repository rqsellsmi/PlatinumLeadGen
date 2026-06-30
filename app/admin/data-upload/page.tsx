import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { uploadBatches } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';
import DataUploadClient, { type BatchRow } from '@/components/admin/DataUploadClient';

export const dynamic = 'force-dynamic';

export default async function DataUploadPage() {
  await requireAdmin();

  const rows = await db.select().from(uploadBatches).orderBy(desc(uploadBatches.createdAt));
  const batches: BatchRow[] = rows.map((b) => ({
    id: b.id,
    agentRole: b.agentRole,
    fileName: b.fileName,
    rowsImported: b.rowsImported,
    rowsSkipped: b.rowsSkipped,
    rowsErrored: b.rowsErrored,
    earliestCloseDate: b.earliestCloseDate ? new Date(b.earliestCloseDate).toISOString() : null,
    latestCloseDate: b.latestCloseDate ? new Date(b.latestCloseDate).toISOString() : null,
    createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : null,
  }));

  return <DataUploadClient batches={batches} />;
}
