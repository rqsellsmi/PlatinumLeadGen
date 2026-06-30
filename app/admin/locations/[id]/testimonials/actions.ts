'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { testimonials } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';

function intOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : Math.trunc(n);
}
function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

async function revalidateLocation(locationId: number) {
  revalidatePath('/sell/[slug]', 'page');
  revalidatePath(`/admin/locations/${locationId}/testimonials`);
}

function values(formData: FormData) {
  const clientName = String(formData.get('clientName') ?? '').trim();
  const quote = String(formData.get('quote') ?? '').trim();
  if (!clientName || !quote) throw new Error('Client name and quote are required');
  return {
    clientName,
    quote,
    neighborhood: str(formData.get('neighborhood')),
    saleDetails: str(formData.get('saleDetails')),
    photoUrl: str(formData.get('photoUrl')),
    displayOrder: intOrNull(formData.get('displayOrder')) ?? 0,
    isActive: formData.get('isActive') === 'on',
    isFeatured: formData.get('isFeatured') === 'on',
  };
}

export async function createTestimonial(formData: FormData) {
  await requireAdmin();
  const locationId = Number(formData.get('locationId'));
  if (!locationId) throw new Error('Invalid location');
  await db.insert(testimonials).values({ locationId, ...values(formData) });
  await revalidateLocation(locationId);
}

export async function updateTestimonial(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('testimonialId'));
  const locationId = Number(formData.get('locationId'));
  if (!id) throw new Error('Invalid testimonial');
  await db.update(testimonials).set(values(formData)).where(eq(testimonials.id, id));
  await revalidateLocation(locationId);
}

export async function deleteTestimonial(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('testimonialId'));
  const locationId = Number(formData.get('locationId'));
  if (!id) throw new Error('Invalid testimonial');
  await db.delete(testimonials).where(eq(testimonials.id, id));
  await revalidateLocation(locationId);
}
