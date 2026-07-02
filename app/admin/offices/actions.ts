'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { offices } from '@/drizzle/schema';
import { geocodeAddress } from '@/lib/geocode';
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
    // Manual coordinates are an optional override; otherwise geocoded below.
    latitude: num(formData.get('latitude')),
    longitude: num(formData.get('longitude')),
  };
}

/**
 * Fill lat/lng from the office address when they weren't supplied manually.
 * Office coordinates anchor proximity-based lead routing (office is the agent's
 * fallback location), so we geocode automatically. Falls back to null (unrouted
 * by proximity) if geocoding isn't configured or the address doesn't resolve.
 */
async function withCoords(v: ReturnType<typeof officeValues>) {
  if (v.latitude != null && v.longitude != null) return v;
  const geo = await geocodeAddress(v);
  return geo ? { ...v, latitude: geo.lat, longitude: geo.lng } : v;
}

export async function createOffice(formData: FormData) {
  await requireAdmin();
  await db.insert(offices).values(await withCoords(officeValues(formData)));
  revalidatePath('/admin/offices');
}

export async function updateOffice(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('officeId'));
  if (!id) throw new Error('Invalid office');
  await db
    .update(offices)
    .set({ ...(await withCoords(officeValues(formData))), updatedAt: new Date() })
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
