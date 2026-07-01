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

function revalidate() {
  revalidatePath('/sell/[slug]', 'page');
  revalidatePath('/');
  revalidatePath('/admin/testimonials');
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
  if (!locationId) throw new Error('Please choose a city');
  await db.insert(testimonials).values({ locationId, ...values(formData) });
  revalidate();
}

export async function updateTestimonial(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('testimonialId'));
  const locationId = Number(formData.get('locationId'));
  if (!id) throw new Error('Invalid testimonial');
  if (!locationId) throw new Error('Please choose a city');
  await db
    .update(testimonials)
    .set({ locationId, ...values(formData) })
    .where(eq(testimonials.id, id));
  revalidate();
}

export async function deleteTestimonial(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('testimonialId'));
  if (!id) throw new Error('Invalid testimonial');
  await db.delete(testimonials).where(eq(testimonials.id, id));
  revalidate();
}
