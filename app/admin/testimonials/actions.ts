'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { testimonials, notificationSettings, googleReviews } from '@/drizzle/schema';
import { fetchGooglePlaceReviews } from '@/lib/googleReviews';
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

/** Save the testimonial source (manual | google | both) + Google Place ID. */
export async function saveReviewSettings(formData: FormData) {
  await requireAdmin();
  const raw = String(formData.get('testimonialSource') ?? 'manual');
  const source = ['manual', 'google', 'both'].includes(raw) ? raw : 'manual';
  const placeId = str(formData.get('googlePlaceId'));
  const rows = await db.select({ id: notificationSettings.id }).from(notificationSettings).limit(1);
  if (rows[0]) {
    await db
      .update(notificationSettings)
      .set({ testimonialSource: source, googlePlaceId: placeId, updatedAt: new Date() })
      .where(eq(notificationSettings.id, rows[0].id));
  } else {
    await db.insert(notificationSettings).values({ testimonialSource: source, googlePlaceId: placeId });
  }
  revalidate();
}

/** Pull the latest Google reviews for the configured Place ID into the cache. */
export async function refreshGoogleReviews() {
  await requireAdmin();
  const rows = await db
    .select({ placeId: notificationSettings.googlePlaceId })
    .from(notificationSettings)
    .limit(1);
  const placeId = rows[0]?.placeId ?? null;
  if (!placeId) throw new Error('Set a Google Place ID and save first');

  const reviews = await fetchGooglePlaceReviews(placeId);
  await db.delete(googleReviews).where(eq(googleReviews.placeId, placeId));
  if (reviews.length) {
    await db.insert(googleReviews).values(
      reviews.map((r) => ({
        placeId,
        authorName: r.authorName,
        rating: r.rating,
        text: r.text,
        relativeTime: r.relativeTime,
        profilePhotoUrl: r.profilePhotoUrl,
        reviewTime: r.reviewTime,
      })),
    );
  }
  revalidate();
}
