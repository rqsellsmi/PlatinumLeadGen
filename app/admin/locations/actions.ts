'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import { slugifyCity } from '@/lib/utils';
import { requireAdmin } from '@/components/admin/requireAdmin';

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export async function createLocation(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Name is required');
  const state = String(formData.get('state') ?? '').trim() || 'MI';
  await db.insert(locations).values({
    name,
    slug: slugifyCity(name),
    state,
    latitude: num(formData.get('lat')),
    longitude: num(formData.get('lng')),
  });
  revalidatePath('/admin/locations');
}

export async function updateLocationDistrict(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('locationId'));
  if (!id) throw new Error('Invalid location');
  const raw = String(formData.get('schoolDistrict') ?? '').trim();
  await db
    .update(locations)
    .set({ schoolDistrict: raw || null, updatedAt: new Date() })
    .where(eq(locations.id, id));
  revalidatePath('/admin/locations');
}

export async function toggleLocationActive(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('locationId'));
  const isActive = String(formData.get('isActive')) === 'true';
  if (!id) throw new Error('Invalid location');
  await db
    .update(locations)
    .set({ isActive: !isActive, updatedAt: new Date() })
    .where(eq(locations.id, id));
  revalidatePath('/admin/locations');
}
