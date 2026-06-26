'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { locations } from '@/drizzle/schema';
import { validateFaqJson } from '@/lib/seo';
import { invalidateLocationCache } from '@/lib/redis';
import { requireAdmin } from '@/components/admin/requireAdmin';

export interface SaveSeoState {
  error?: string;
  success?: boolean;
}

function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

export async function saveSeo(_prev: SaveSeoState, formData: FormData): Promise<SaveSeoState> {
  await requireAdmin();
  const id = Number(formData.get('locationId'));
  if (!id) return { error: 'Invalid location' };

  const faqJson = String(formData.get('faqJson') ?? '[]');
  const result = validateFaqJson(faqJson);
  if (!result.valid) {
    return { error: `FAQ invalid: ${result.error ?? 'unknown error'}` };
  }

  // Normalize: store an empty array as null to keep the column tidy.
  const normalizedFaq = result.items && result.items.length > 0 ? JSON.stringify(result.items) : null;

  const rows = await db
    .update(locations)
    .set({
      metaTitle: str(formData.get('metaTitle')),
      metaDescription: str(formData.get('metaDescription')),
      heroHeadline: str(formData.get('heroHeadline')),
      heroSubheadline: str(formData.get('heroSubheadline')),
      guideUrl: str(formData.get('guideUrl')),
      faqJson: normalizedFaq,
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id))
    .returning({ slug: locations.slug });

  const slug = rows[0]?.slug;
  if (slug) await invalidateLocationCache(slug);
  revalidatePath('/sell/[slug]', 'page');
  revalidatePath(`/admin/locations/${id}/seo`);
  return { success: true };
}
