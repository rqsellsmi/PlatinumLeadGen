'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { closings } from '@/drizzle/schema';
import { requireAdmin } from '@/components/admin/requireAdmin';

/** Attach (or clear) the showcase photo for a single imported sale. */
export async function updateClosingPhoto(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get('closingId'));
  if (!id) throw new Error('Invalid sale');
  const url = String(formData.get('photoUrl') ?? '').trim() || null;
  await db.update(closings).set({ photoUrl: url }).where(eq(closings.id, id));
  revalidatePath('/admin/recent-sales');
  revalidatePath('/', 'page');
  revalidatePath('/sell/[slug]', 'page');
}
