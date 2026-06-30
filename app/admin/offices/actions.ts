'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

function officeValues(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Office name is required');
  return {
    name,
    address: str(formData.get('address')),
    city: str(formData.get('city')),
    state: str(formData.get('state')),
    zip: str(formData.get('zip')),
    phone: str(formData.get('phone')),
    latitude: num(formData.get('latitude')),
    longitude: num(formData.get('longitude')),
  };
}

export async function createOffice(formData: FormData) {
  await requireAdmin();
  await db.insert(offices).values(officeValues(formData));
  revalidatePath('/admin/offices');
}

export async function updateOffice(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('officeId'));
  if (!id) throw new Error('Invalid office');
  await db
    .update(offices)
    .set({ ...officeValues(formData), updatedAt: new Date() })
    .where(eq(offices.id, id));
  revalidatePath('/admin/offices');
}

export async function deleteOffice(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('officeId'));
  if (!id) throw new Error('Invalid office');
  await db.delete(offices).where(eq(offices.id, id));
  revalidatePath('/admin/offices');
}
