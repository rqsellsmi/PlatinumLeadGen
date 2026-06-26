'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations, recentSales } from '@/drizzle/schema';
import { invalidateLocationCache } from '@/lib/redis';
import { requireAdmin } from '@/components/admin/requireAdmin';

function intOrNull(v: FormDataEntryValue | string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : Math.trunc(n);
}
function dateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function revalidateLocation(locationId: number) {
  const loc = await db
    .select({ slug: locations.slug })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (loc[0]?.slug) await invalidateLocationCache(loc[0].slug);
  revalidatePath('/sell/[slug]', 'page');
  revalidatePath(`/admin/locations/${locationId}/sales`);
}

export async function createSale(formData: FormData) {
  await requireAdmin();
  const locationId = Number(formData.get('locationId'));
  const address = String(formData.get('address') ?? '').trim();
  if (!locationId || !address) throw new Error('Location and address are required');
  await db.insert(recentSales).values({
    locationId,
    address,
    soldPrice: intOrNull(formData.get('soldPrice')),
    daysOnMarket: intOrNull(formData.get('daysOnMarket')),
    closeDate: dateOrNull(String(formData.get('closeDate') ?? '') || null),
    photoUrl: String(formData.get('photoUrl') ?? '').trim() || null,
    displayOrder: intOrNull(formData.get('displayOrder')) ?? 0,
  });
  await revalidateLocation(locationId);
}

export async function updateSale(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('saleId'));
  const locationId = Number(formData.get('locationId'));
  const address = String(formData.get('address') ?? '').trim();
  if (!id || !address) throw new Error('Sale and address are required');
  await db
    .update(recentSales)
    .set({
      address,
      soldPrice: intOrNull(formData.get('soldPrice')),
      daysOnMarket: intOrNull(formData.get('daysOnMarket')),
      closeDate: dateOrNull(String(formData.get('closeDate') ?? '') || null),
      photoUrl: String(formData.get('photoUrl') ?? '').trim() || null,
      displayOrder: intOrNull(formData.get('displayOrder')) ?? 0,
    })
    .where(eq(recentSales.id, id));
  await revalidateLocation(locationId);
}

export async function deleteSale(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('saleId'));
  const locationId = Number(formData.get('locationId'));
  if (!id) throw new Error('Invalid sale');
  await db.delete(recentSales).where(eq(recentSales.id, id));
  await revalidateLocation(locationId);
}

/**
 * Parse pasted CSV lines `address,soldPrice,daysOnMarket,closeDate,photoUrl`
 * and bulk-insert. Blank lines and a leading header row are skipped.
 */
export async function importSalesCsv(formData: FormData) {
  await requireAdmin();
  const locationId = Number(formData.get('locationId'));
  if (!locationId) throw new Error('Invalid location');
  const csv = String(formData.get('csv') ?? '');

  const rows: (typeof recentSales.$inferInsert)[] = [];
  let order = 0;
  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(',').map((p) => p.trim());
    const address = parts[0];
    if (!address || address.toLowerCase() === 'address') continue; // skip header
    rows.push({
      locationId,
      address,
      soldPrice: intOrNull(parts[1] ?? null),
      daysOnMarket: intOrNull(parts[2] ?? null),
      closeDate: dateOrNull(parts[3] ?? null),
      photoUrl: parts[4] || null,
      displayOrder: order++,
    });
  }

  if (rows.length > 0) await db.insert(recentSales).values(rows);
  await revalidateLocation(locationId);
}
