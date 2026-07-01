'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { recentSales } from '@/drizzle/schema';
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

function revalidate() {
  revalidatePath('/sell/[slug]', 'page');
  revalidatePath('/admin/recent-sales');
}

export async function createSale(formData: FormData) {
  await requireAdmin();
  const locationId = Number(formData.get('locationId'));
  const address = String(formData.get('address') ?? '').trim();
  if (!locationId) throw new Error('Please choose a city');
  if (!address) throw new Error('Address is required');
  await db.insert(recentSales).values({
    locationId,
    address,
    soldPrice: intOrNull(formData.get('soldPrice')),
    daysOnMarket: intOrNull(formData.get('daysOnMarket')),
    closeDate: dateOrNull(String(formData.get('closeDate') ?? '') || null),
    photoUrl: String(formData.get('photoUrl') ?? '').trim() || null,
    displayOrder: intOrNull(formData.get('displayOrder')) ?? 0,
  });
  revalidate();
}

export async function updateSale(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('saleId'));
  const locationId = Number(formData.get('locationId'));
  const address = String(formData.get('address') ?? '').trim();
  if (!id) throw new Error('Invalid sale');
  if (!locationId) throw new Error('Please choose a city');
  if (!address) throw new Error('Address is required');
  await db
    .update(recentSales)
    .set({
      locationId,
      address,
      soldPrice: intOrNull(formData.get('soldPrice')),
      daysOnMarket: intOrNull(formData.get('daysOnMarket')),
      closeDate: dateOrNull(String(formData.get('closeDate') ?? '') || null),
      photoUrl: String(formData.get('photoUrl') ?? '').trim() || null,
      displayOrder: intOrNull(formData.get('displayOrder')) ?? 0,
    })
    .where(eq(recentSales.id, id));
  revalidate();
}

export async function deleteSale(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('saleId'));
  if (!id) throw new Error('Invalid sale');
  await db.delete(recentSales).where(eq(recentSales.id, id));
  revalidate();
}

/**
 * Parse pasted CSV lines `address,soldPrice,daysOnMarket,closeDate,photoUrl`
 * for the chosen city and bulk-insert. Blank lines and a leading header row
 * are skipped.
 */
export async function importSalesCsv(formData: FormData) {
  await requireAdmin();
  const locationId = Number(formData.get('locationId'));
  if (!locationId) throw new Error('Please choose a city');
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
  revalidate();
}
